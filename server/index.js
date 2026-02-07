const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
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

// ✅ MONGODB BAĞLANTISI
mongoose.connect('mongodb+srv://kerem:kerem123456@kerem.ymzaggx.mongodb.net/?appName=kerem')
    .then(() => console.log("✅ MongoDB Bağlandı!"))
    .catch((err) => console.error("❌ Hata:", err));

// 🕵️‍♂️ GELİŞMİŞ ÜRÜN ÇEKME FONKSİYONU
async function scrapeProduct(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            }
        });
        
        const $ = cheerio.load(data);
        let name = null;
        let price = null;
        let image = "https://cdn.dsmcdn.com/web/production/ty-web.svg";

        // --- TRENDYOL İÇİN GELİŞMİŞ ARAMA ---
        if (url.includes('trendyol')) {
            // 1. İsim Bulma (Sırayla dener)
            name = $('h1.pr-new-br').text().trim() || 
                   $('.product-name-text').text().trim() || 
                   $('meta[property="og:title"]').attr('content');

            // 2. Fiyat Bulma (Sırayla dener - En önemlisi burası!)
            let rawPrice = $('.prc-dsc').text().trim() || 
                           $('.product-price-container-price').text().trim() ||
                           $('.pr-bx-w .prc-box-sll').text().trim(); // Sepette indirimli fiyat
            
            // Eğer script içindeyse oradan al
            if (!rawPrice) {
                 const scriptPrice = $('script:contains("price")').text();
                 // Basit bir regex ile fiyatı scriptten avla
                 const match = scriptPrice.match(/"price":\s*(\d+\.?\d*)/);
                 if (match) rawPrice = match[1];
            }

            // 3. Resim Bulma
            image = $('.base-product-image > div > img').attr('src') || 
                    $('meta[property="og:image"]').attr('content') || image;

            // Fiyat Temizliği (TL yazısını ve noktaları temizle)
            if (rawPrice) {
                // "1.299 TL" -> 1299
                rawPrice = rawPrice.replace('TL', '').replace(/\./g, '').replace(/,/g, '.').trim();
                price = parseFloat(rawPrice);
            }
        } 
        
        // --- AMAZON İÇİN ---
        else if (url.includes('amazon')) {
            name = $('#productTitle').text().trim();
            let priceWhole = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            let priceFraction = $('.a-price-fraction').first().text();
            image = $('#landingImage').attr('src');
            
            if (priceWhole) {
                price = parseFloat(priceWhole);
                if (priceFraction) price += parseFloat("0." + priceFraction);
            }
        }

        // SON KONTROL: Eğer isim ve fiyat bulduysa gönder
        if (name && price && !isNaN(price)) {
            return { name, price, image };
        }
        return null;

    } catch (error) {
        console.log("Scrape Hatası:", error.message);
        return null; 
    }
}

// Otomatik Kontrol (Her 5 dakikada bir)
cron.schedule('*/5 * * * *', async () => {
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
        
        if (!data) return res.status(400).json({ error: "Fiyatı göremedim! Linki kontrol et veya başka ürün dene." });
        
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