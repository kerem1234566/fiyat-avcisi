const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios'); // Yeni hafif motor
const cheerio = require('cheerio'); // Yeni okuyucu
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

// --- MONGODB BAĞLANTISI (Senin Şifrenle) ---
mongoose.connect('mongodb+srv://kerem:kerem123456@kerem.ymzaggx.mongodb.net/?appName=kerem')
    .then(() => console.log("✅ MongoDB Bağlandı!"))
    .catch((err) => console.error("❌ Hata:", err));

// --- YENİ HAFİF ÜRÜN ÇEKME FONKSİYONU ---
async function scrapeProduct(url) {
    try {
        // Tarayıcı açmak yerine direkt HTML kodunu çekiyoruz (Çok daha hızlı)
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
            }
        });
        
        const $ = cheerio.load(data);
        let productData = null;

        if (url.includes('amazon')) {
            const title = $('#productTitle').text().trim();
            const priceWhole = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            const priceFraction = $('.a-price-fraction').first().text();
            const image = $('#landingImage').attr('src');
            
            if (title && priceWhole) {
                let finalPrice = parseFloat(priceWhole);
                if (priceFraction) finalPrice += parseFloat("0." + priceFraction);
                productData = { name: title, price: finalPrice, image: image };
            }
        } 
        else if (url.includes('trendyol')) {
            const scriptContent = $('script[type="application/ld+json"]').first().html();
            if (scriptContent) {
                try {
                    const json = JSON.parse(scriptContent);
                    if (json && json.offers && json.offers.price) {
                        let finalImage = "https://cdn.dsmcdn.com/web/production/ty-web.svg";
                        // Resim bulma mantığı
                        if (json.image) {
                            if (typeof json.image === 'string') finalImage = json.image;
                            else if (Array.isArray(json.image) && json.image.length > 0) finalImage = json.image[0];
                            else if (typeof json.image === 'object' && json.image.url) finalImage = json.image.url;
                        }
                        productData = { name: json.name, price: parseFloat(json.offers.price), image: finalImage };
                    }
                } catch (e) {}
            }
        }

        return productData;

    } catch (error) {
        console.log("Hata:", error.message);
        return null; 
    }
}

cron.schedule('* * * * *', async () => {
    console.log("⏰ KONTROL BAŞLADI...");
    const products = await Product.find({ owner: { $ne: null } }); 
    for (const product of products) {
        const newData = await scrapeProduct(product.url);
        if (newData) {
            product.currentPrice = newData.price;
            product.priceHistory.push({ price: newData.price }); 
            await product.save();
            console.log(`✅ ${newData.name.substring(0,15)}... -> ${newData.price} TL`);
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
    try { 
        const hashedPassword = await bcrypt.hash(password, 10); 
        const newUser = new User({ username, password: hashedPassword }); 
        await newUser.save(); 
        res.json({ message: "Kayıt Oldu!" }); 
    } catch (e) { res.status(500).json({ error: "Kullanıcı adı alınmış!" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try { 
        const user = await User.findOne({ username }); 
        if (!user) return res.status(400).json({ error: "Kullanıcı yok!" }); 
        const isMatch = await bcrypt.compare(password, user.password); 
        if (!isMatch) return res.status(400).json({ error: "Şifre yanlış!" }); 
        const token = jwt.sign({ id: user._id }, JWT_SECRET); 
        res.json({ token, username: user.username }); 
    } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

app.post('/add-product', verifyToken, async (req, res) => {
    const { url } = req.body; 
    if (!url) return res.status(400).json({ error: 'Link lazım!' });
    try { 
        console.log(`🕷️  Aranıyor: ${url}`); 
        const data = await scrapeProduct(url); 
        if (!data) return res.status(400).json({ error: "Veri alınamadı! Linki kontrol et." });
        
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

app.get('/my-products', verifyToken, async (req, res) => { 
    try { 
        const products = await Product.find({ owner: req.user.id }); 
        res.json(products); 
    } catch (e) { res.status(500).json({ error: "Liste hatası" }); } 
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));