const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const puppeteer = require('puppeteer');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const cron = require('node-cron'); 
require('dotenv').config();

const Product = require('./models/Product');
const User = require('./models/User'); 

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = "cok_gizli_bir_sifre_buraya_yazilir"; 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Bağlandı!"))
    .catch((err) => console.error("❌ Hata:", err));

// --- ROBOT FONKSİYONU ---
async function scrapeProduct(url) {
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        let data = null;

        if (url.includes('amazon')) {
            // AMAZON (Klasik)
            data = await page.evaluate(() => {
                const priceElement = document.querySelector('.a-price-whole');
                const fractionElement = document.querySelector('.a-price-fraction');
                const titleElement = document.querySelector('#productTitle');
                const imgElement = document.querySelector('#landingImage');
                if (!priceElement) return null;
                let rawPrice = priceElement.innerText.replace(/\./g, '').replace(/,/g, '');
                if (fractionElement) rawPrice += '.' + fractionElement.innerText;
                return { name: titleElement ? titleElement.innerText.trim() : "Amazon Ürünü", price: parseFloat(rawPrice), image: imgElement ? imgElement.src : "" };
            });
        } 
        else if (url.includes('trendyol')) {
            // TRENDYOL (KUTU AÇICI MOD)
            data = await page.evaluate(() => {
                try {
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (let script of scripts) {
                        try {
                            const json = JSON.parse(script.innerText);
                            
                            // Fiyat bilgisi olan doğru veriyi bulduk mu?
                            if (json && json.offers && json.offers.price) {
                                
                                // --- AKILLI RESİM SEÇİCİ ---
                                let finalImage = "https://cdn.dsmcdn.com/web/production/ty-web.svg"; // Varsayılan

                                if (json.image) {
                                    // DURUM 1: Direkt Link Gelirse (Örn: "https://...")
                                    if (typeof json.image === 'string') {
                                        finalImage = json.image;
                                    }
                                    // DURUM 2: Dizi Gelirse (Örn: ["https://...", ...])
                                    else if (Array.isArray(json.image)) {
                                        // İlk eleman string mi yoksa obje mi?
                                        if (typeof json.image[0] === 'string') finalImage = json.image[0];
                                        else if (json.image[0].url) finalImage = json.image[0].url;
                                        else if (json.image[0].contentUrl) finalImage = json.image[0].contentUrl;
                                    }
                                    // DURUM 3: Kutu (Obje) Gelirse (HATA BURADAYDI!)
                                    else if (typeof json.image === 'object') {
                                        // contentUrl bazen dizi, bazen string olabilir
                                        let content = json.image.url || json.image.contentUrl;
                                        if (Array.isArray(content)) finalImage = content[0];
                                        else finalImage = content;
                                    }
                                }
                                // ---------------------------

                                return {
                                    name: json.name,
                                    price: parseFloat(json.offers.price),
                                    image: finalImage // Artık temizlenmiş linki gönderiyoruz
                                };
                            }
                        } catch(e) {}
                    }
                    return null; 
                } catch (e) { return null; }
            });
        }

        await browser.close();
        return data;

    } catch (error) {
        await browser.close();
        console.log("Hata:", error.message);
        return null; 
    }
}

// --- OTOMATİK KONTROL ---
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

// --- AUTH & ROUTES ---
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
    const { url } = req.body; if (!url) return res.status(400).json({ error: 'Link lazım!' });
    try { console.log(`🕷️  Aranıyor: ${url}`); const data = await scrapeProduct(url); if (!data) return res.status(400).json({ error: "Veri alınamadı!" });
    const newProduct = new Product({ url: url, name: data.name, image: data.image, currentPrice: data.price, priceHistory: [{ price: data.price }], owner: req.user.id });
    await newProduct.save(); res.json({ message: "Başarılı!", product: newProduct }); } catch (e) { console.error("HATA:", e.message); res.status(500).json({ error: "Sunucu Hatası: " + e.message }); }
});
app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));