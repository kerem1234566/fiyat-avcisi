const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const puppeteer = require('puppeteer');
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

// Site dosyalarını sunmak için gerekli ayar:
app.use(express.static(path.join(__dirname, '../client')));

const JWT_SECRET = "cok_gizli_bir_sifre_buraya_yazilir"; 

// ✅ MONGODB BAĞLANTISI (Kesin Çalışan Hali)
mongoose.connect('mongodb+srv://kerem:kerem123456@kerem.ymzaggx.mongodb.net/?appName=kerem')
    .then(() => console.log("✅ MongoDB Bağlandı!"))
    .catch((err) => console.error("❌ Hata:", err));

// 🕷️ GÜÇLÜ ÜRÜN ÇEKME MOTORU (PUPPETEER)
async function scrapeProduct(url) {
    let browser = null;
    try {
        // Render için özel bellek ayarları
        browser = await puppeteer.launch({ 
            headless: "new", 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Bellek tasarrufu
                '--disable-gpu'
            ] 
        });
        
        const page = await browser.newPage();
        // Gerçek insan gibi görünme ayarı
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        let data = null;

        if (url.includes('amazon')) {
            data = await page.evaluate(() => {
                // Eğer Robot kontrolü varsa boş dön
                const titleEl = document.querySelector('#productTitle');
                const priceEl = document.querySelector('.a-price-whole');
                const imgEl = document.querySelector('#landingImage');

                if (!titleEl || !priceEl) return null;

                let rawPrice = priceEl.innerText.replace(/\./g, '').replace(/,/g, '');
                const fractionEl = document.querySelector('.a-price-fraction');
                if (fractionEl) rawPrice += '.' + fractionEl.innerText;

                return { 
                    name: titleEl.innerText.trim(), 
                    price: parseFloat(rawPrice), 
                    image: imgEl ? imgEl.src : "" 
                };
            });
        } 
        else if (url.includes('trendyol')) {
            data = await page.evaluate(() => {
                try {
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (let script of scripts) {
                        const json = JSON.parse(script.innerText);
                        if (json && json.offers && json.offers.price) {
                             let finalImage = "https://cdn.dsmcdn.com/web/production/ty-web.svg";
                             if (json.image && json.image.length > 0) finalImage = json.image[0];
                             if (json.image && json.image.url) finalImage = json.image.url;
                             
                             return { name: json.name, price: parseFloat(json.offers.price), image: finalImage };
                        }
                    }
                    return null; 
                } catch (e) { return null; }
            });
        }

        await browser.close();
        return data;

    } catch (error) {
        if(browser) await browser.close();
        console.log("Scrape Hatası:", error.message);
        return null; 
    }
}

// Otomatik Kontrol (Her 5 dakikada bir - Sistemi yormamak için)
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
        
        // Eğer Amazon engellerse veya ürün bulunamazsa:
        if (!data || isNaN(data.price)) return res.status(400).json({ error: "Veri çekilemedi (Robot koruması veya hatalı link)." });
        
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
        // 500 hatası yerine 400 döndür ki site çökmesin
        res.status(400).json({ error: "İşlem başarısız: " + e.message }); 
    }
});

app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '../client/index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));