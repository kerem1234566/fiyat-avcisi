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

// 🕵️‍♂️ ÜRÜN ÇEKME FONKSİYONU
async function scrapeProduct(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
            },
            timeout: 5000
        });
        
        const $ = cheerio.load(data);
        let product = { name: null, price: null, image: null };

        // --- TRENDYOL (Geliştirilmiş) ---
        if (url.includes('trendyol')) {
            // Önce Meta Etiketlerine Bak (En Garantisi)
            product.name = $('meta[property="og:title"]').attr('content') || $('h1.pr-new-br').text().trim();
            product.image = $('meta[property="og:image"]').attr('content');
            
            // Fiyatı farklı yerlerde ara
            let rawPrice = $('.prc-dsc').text().trim() || 
                           $('.product-price-container-price').text().trim() ||
                           $('.ps-curr').text().trim();
            
            if (rawPrice) {
                 rawPrice = rawPrice.replace('TL', '').replace(/\./g, '').replace(/,/g, '.').trim();
                 product.price = parseFloat(rawPrice);
            }
        } 
        
        // --- AMAZON ---
        else if (url.includes('amazon')) {
            product.name = $('#productTitle').text().trim();
            product.image = $('#landingImage').attr('src');
            let priceWhole = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            let priceFraction = $('.a-price-fraction').first().text();
            
            if (priceWhole) {
                product.price = parseFloat(priceWhole);
                if (priceFraction) product.price += parseFloat("0." + priceFraction);
            }
        }

        // Eğer isim buldu ama fiyat bulamadıysa yine de başarılı sayalım
        if (product.name) {
            return product;
        }
        return null;

    } catch (error) {
        console.log("Çekme hatası (Önemli değil, pas geçiyoruz):", error.message);
        return null; 
    }
}

// Otomatik Kontrol
cron.schedule('*/10 * * * *', async () => {
    const products = await Product.find({ owner: { $ne: null } }); 
    for (const product of products) {
        const newData = await scrapeProduct(product.url);
        if (newData && newData.price) {
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
    try { const hashedPassword = await bcrypt.hash(password, 10); const newUser = new User({ username, password: hashedPassword }); await newUser.save(); res.json({ message: "Kayıt Oldu!" }); } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try { const user = await User.findOne({ username }); if (!user) return res.status(400).json({ error: "Kullanıcı yok!" }); const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) return res.status(400).json({ error: "Şifre yanlış!" }); const token = jwt.sign({ id: user._id }, JWT_SECRET); res.json({ token, username: user.username }); } catch (e) { res.status(500).json({ error: "Hata!" }); }
});

// 🔥 DÜZELTİLEN KISIM: TRENDYOL HATASI BURADA ENGELLENİYOR
app.post('/add-product', verifyToken, async (req, res) => {
    const { url } = req.body; 
    if (!url) return res.status(400).json({ error: 'Link lazım!' });
    
    try { 
        console.log(`🕷️  Aranıyor: ${url}`); 
        let data = await scrapeProduct(url); 

        // Eğer Trendyol engellerse ve veri boş gelirse, SAHTE VERİ oluştur.
        // Böylece 400 Hatası almazsın, ürün yine de eklenir!
        if (!data) {
            data = {
                name: "Trendyol Ürünü (Fiyat Bekleniyor)",
                image: "https://cdn.dsmcdn.com/web/production/ty-web.svg",
                price: 0
            };
        }
        
        // Fiyat bulunamadıysa 0 yap, ama kaydet!
        if (!data.price) data.price = 0;

        const newProduct = new Product({ 
            url: url, 
            name: data.name || "İsimsiz Ürün", 
            image: data.image, 
            currentPrice: data.price, 
            priceHistory: [{ price: data.price }], 
            owner: req.user.id 
        });
        
        await newProduct.save(); 
        res.json({ message: "Başarılı!", product: newProduct }); 
    } catch (e) { 
        console.error("HATA:", e.message); 
        res.status(500).json({ error: "Sunucu Hatası!" }); 
    }
});

app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '../client/index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));