const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios'); // Hafif motor
const cheerio = require('cheerio'); // Kod okuyucu
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const cron = require('node-cron'); 
const path = require('path'); 
require('dotenv').config();

const Product = require('./models/Product');
const User = require('./models/User'); 

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../client')));

const JWT_SECRET = "cok_gizli_bir_sifre_buraya_yazilir"; 

// ✅ MONGODB BAĞLANTISI (Senin Şifrenle)
mongoose.connect('mongodb+srv://kerem:kerem123456@kerem.ymzaggx.mongodb.net/?appName=kerem')
    .then(() => console.log("✅ MongoDB Bağlandı!"))
    .catch((err) => console.error("❌ Hata:", err));

// 🕵️‍♂️ GİZLİ AJAN ÜRÜN ÇEKME FONKSİYONU
async function scrapeProduct(url) {
    try {
        // Amazon ve Trendyol'u kandırmak için "Ben Chrome Tarayıcısıyım" diyoruz
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const $ = cheerio.load(data);
        let productData = null;

        // --- TRENDYOL MANTIĞI ---
        if (url.includes('trendyol')) {
            // 1. Yöntem: Gizli Script verisini oku
            const scriptContent = $('script[type="application/ld+json"]').first().html();
            if (scriptContent) {
                try {
                    const json = JSON.parse(scriptContent);
                    if (json && json.offers && json.offers.price) {
                        let finalImage = "https://cdn.dsmcdn.com/web/production/ty-web.svg";
                        if (json.image) {
                             if(typeof json.image === 'string') finalImage = json.image;
                             else if(Array.isArray(json.image)) finalImage = json.image[0];
                        }
                        return { name: json.name, price: parseFloat(json.offers.price), image: finalImage };
                    }
                } catch (e) {}
            }
            // 2. Yöntem: Direkt sayfadan oku (Yedek)
            const priceText = $('.prc-dsc').text().replace('TL', '').replace(/\./g, '').replace(/,/g, '.').trim();
            const nameText = $('.pr-new-br').text().trim() + " " + $('.pr-new-br span').text().trim();
            const imgLink = $('.base-product-image > div > img').attr('src');
            
            if (priceText) {
                return { name: nameText || "Trendyol Ürünü", price: parseFloat(priceText), image: imgLink || "" };
            }
        } 
        
        // --- AMAZON MANTIĞI ---
        else if (url.includes('amazon')) {
            const title = $('#productTitle').text().trim();
            const priceWhole = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            const priceFraction = $('.a-price-fraction').first().text();
            const image = $('#landingImage').attr('src');
            
            if (title && priceWhole) {
                let finalPrice = parseFloat(priceWhole);
                if (priceFraction) finalPrice += parseFloat("0." + priceFraction);
                return { name: title, price: finalPrice, image: image };
            }
        }

        return null;

    } catch (error) {
        console.log("Scrape Hatası (Site engelledi veya link bozuk):", error.message);
        return null; 
    }
}

// Otomatik Kontrol (Her 5 dakikada bir)
cron.schedule('*/5 * * * *', async () => {
    console.log("⏰ KONTROL BAŞLADI...");
    const products = await Product.find({ owner: { $ne: null } }); 
    for (const product of products) {
        const newData = await scrapeProduct(product.url);
        if (newData) {
            product.currentPrice = newData.price;
            product.priceHistory.push({ price: newData.price }); 
            await product.save();
        }
    }
});

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Giriş yap!" });
    try {
        const pureToken = token.split(' ')[1];
        const decoded = jwt.verify(pureToken, JWT_SECRET);
        req.user = decoded; next();
    } catch (err) { return res.status(401).json({ error: "Geçersiz!" }); }
};

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try { hashedPassword = await bcrypt.hash(password, 10); const newUser = new User({ username, password: hashedPassword }); await newUser.save(); res.json({ message: "Kayıt Oldu!" }); } catch (e) { res.status(500).json({ error: "İsim dolu!" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try { const user = await User.findOne({ username }); if (!user) return res.status(400).json({ error: "Kullanıcı yok!" }); const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) return res.status(400).json({ error: "Şifre yanlış!" }); const token = jwt.sign({ id: user._id }, JWT_SECRET); res.json({ token, username: user.username }); } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

app.post('/add-product', verifyToken, async (req, res) => {
    const { url } = req.body; 
    if (!url) return res.status(400).json({ error: 'Link lazım!' });
    
    try { 
        console.log(`🕷️  Aranıyor: ${url}`); 
        const data = await scrapeProduct(url); 
        
        // Ürün bulunamazsa 500 VERME, 400 VER (Böylece site çökmez, sadece uyarı çıkar)
        if (!data) return res.status(400).json({ error: "Ürün bilgileri çekilemedi! (Site engellemiş olabilir, başka site dene)." });
        
        const newProduct = new Product({ 
            url: url, 
            name: data.name, 
            image: data.image, 
            currentPrice: data.price, 
            priceHistory: [{ price: data.price }], 
            owner: req.user.id 
        });
        await newProduct.save(); 
        res.json({ message: "Başarılı!", product: newProduct }); 
    } catch (e) { 
        console.error("HATA:", e.message); 
        res.status(500).json({ error: "Sunucu Hatası: " + e.message }); 
    }
});

app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '../client/index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));