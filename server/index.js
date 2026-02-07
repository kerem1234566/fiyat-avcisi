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

// 🕵️‍♂️ ARKA PLAN AJANI (Sadece Cron İçin)
async function scrapeProduct(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            },
            timeout: 5000
        });
        const $ = cheerio.load(data);
        let price = null;
        
        // Basit Fiyat Bulucu
        if (url.includes('trendyol')) {
            let rawPrice = $('.prc-dsc').text().trim() || $('.product-price-container-price').text().trim();
            if (rawPrice) price = parseFloat(rawPrice.replace('TL', '').replace(/\./g, '').replace(/,/g, '.'));
        } else if (url.includes('amazon')) {
            let p = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            if (p) price = parseFloat(p);
        }
        return price;
    } catch (error) { return null; }
}

// Otomatik Kontrol (Her 5 dakikada bir dener)
cron.schedule('*/5 * * * *', async () => {
    const products = await Product.find({ owner: { $ne: null } }); 
    for (const product of products) {
        const newPrice = await scrapeProduct(product.url);
        if (newPrice) {
            product.currentPrice = newPrice;
            product.priceHistory.push({ price: newPrice }); 
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
    try { const hashedPassword = await bcrypt.hash(password, 10); const newUser = new User({ username, password: hashedPassword }); await newUser.save(); res.json({ message: "Kayıt Oldu!" }); } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try { const user = await User.findOne({ username }); if (!user) return res.status(400).json({ error: "Kullanıcı yok!" }); const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) return res.status(400).json({ error: "Şifre yanlış!" }); const token = jwt.sign({ id: user._id }, JWT_SECRET); res.json({ token, username: user.username }); } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

// 🔥 İŞTE HİLE BURADA: Sadece Kaydediyoruz, Fiyat Aramıyoruz!
app.post('/add-product', verifyToken, async (req, res) => {
    const { url } = req.body; 
    if (!url) return res.status(400).json({ error: 'Link lazım!' });
    
    try { 
        console.log(`💾 Link Kaydediliyor: ${url}`); 
        
        // Fiyat aramadan direkt kaydediyoruz. Hata verme şansı YOK.
        const newProduct = new Product({ 
            url: url, 
            name: "Yeni Ürün (Fiyat Aranıyor...)", 
            image: "https://cdn.dsmcdn.com/web/production/ty-web.svg", 
            currentPrice: 0, 
            priceHistory: [{ price: 0 }], 
            owner: req.user.id 
        });
        
        await newProduct.save(); 
        res.json({ message: "Başarılı! Ürün listeye eklendi.", product: newProduct }); 
        
    } catch (e) { 
        console.error("HATA:", e.message); 
        res.status(500).json({ error: "Veritabanı hatası!" }); 
    }
});

app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '../client/index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));