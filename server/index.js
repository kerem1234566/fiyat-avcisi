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

// 🛡️ ÖZEL "ASLA ÇÖKME" MODÜLÜ
async function scrapeProduct(url) {
    try {
        // Kendimizi Google Bot gibi tanıtıyoruz (Siteler sever)
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
            timeout: 10000 // 10 saniye bekle, gelmezse zorlama
        });
        
        const $ = cheerio.load(data);
        let name = null;
        let price = null;
        let image = "https://cdn.dsmcdn.com/web/production/ty-web.svg"; // Varsayılan resim

        // --- TRENDYOL ---
        if (url.includes('trendyol')) {
            name = $('h1.pr-new-br').text().trim() || $('.product-name-text').text().trim();
            let rawPrice = $('.prc-dsc').text().trim() || $('.product-price-container-price').text().trim();
            
            // Script içinden fiyat avlama (Yedek Plan)
            if (!rawPrice) {
                 const scriptContent = $('script:contains("price")').text();
                 const match = scriptContent.match(/"price":\s*(\d+\.?\d*)/);
                 if (match) rawPrice = match[1];
            }

            image = $('.base-product-image > div > img').attr('src') || image;

            if (rawPrice) {
                rawPrice = rawPrice.replace('TL', '').replace(/\./g, '').replace(/,/g, '.').trim();
                price = parseFloat(rawPrice);
            }
        } 
        
        // --- AMAZON ---
        else if (url.includes('amazon')) {
            name = $('#productTitle').text().trim();
            let priceWhole = $('.a-price-whole').first().text().replace(/\./g, '').replace(/,/g, '');
            let priceFraction = $('.a-price-fraction').first().text();
            
            if (priceWhole) {
                price = parseFloat(priceWhole);
                if (priceFraction) price += parseFloat("0." + priceFraction);
            }
        }

        // Eğer her şey yolundaysa gerçek veriyi dön
        if (name && price) {
            return { name, price, image, success: true };
        }
        
        // 🔥 KURTARMA PLANI: Veri çekemedik ama HATA VERMİYORUZ.
        // Kullanıcıya "Bulamadım" demek yerine boş ürün oluşturuyoruz.
        return { 
            name: "Ürün Eklendi (Fiyat Bekleniyor...)", 
            price: 0, 
            image: "https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg",
            success: false 
        };

    } catch (error) {
        console.log("Engel yedik ama çaktırmıyoruz:", error.message);
        // Hata olsa bile bunu dönüyoruz ki site çökmesin
        return { 
            name: "Site Bağlantı Hatası (Link Eklendi)", 
            price: 0, 
            image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Error.svg/1200px-Error.svg.png",
            success: false 
        }; 
    }
}

// Otomatik Kontrol (Her 10 dakikada bir)
cron.schedule('*/10 * * * *', async () => {
    const products = await Product.find({ owner: { $ne: null } }); 
    for (const product of products) {
        const newData = await scrapeProduct(product.url);
        // Sadece gerçek veri geldiyse güncelle
        if (newData && newData.success) {
            product.currentPrice = newData.price;
            product.name = newData.name; // İsmi de güncelle
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
        // Veriyi çekmeye çalış
        const data = await scrapeProduct(url); 
        
        // HATA YOK! Ne gelirse gelsin kaydediyoruz.
        const newProduct = new Product({ 
            url: url, 
            name: data.name, // Bulamazsa 'Fiyat Bekleniyor' yazar
            image: data.image, 
            currentPrice: data.price, // Bulamazsa 0 yazar
            priceHistory: [{ price: data.price }], 
            owner: req.user.id 
        });
        
        await newProduct.save(); 
        
        // Kullanıcıya her zaman BAŞARILI dönüyoruz
        res.json({ message: "Listeye Alındı!", product: newProduct }); 
        
    } catch (e) { 
        console.error("KRİTİK HATA:", e.message); 
        res.status(500).json({ error: "Veritabanı hatası!" }); 
    }
});

app.get('/my-products', verifyToken, async (req, res) => { try { const products = await Product.find({ owner: req.user.id }); res.json(products); } catch (e) { res.status(500).json({ error: "Liste hatası" }); } });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '../client/index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu Hazır: http://localhost:${PORT}`));