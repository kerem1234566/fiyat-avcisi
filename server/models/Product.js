const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    url: { type: String, required: true },
    name: { type: String, required: true },
    image: String,
    currentPrice: { type: Number, required: true },
    priceHistory: [
        {
            price: { type: Number, required: true },
            date: { type: Date, default: Date.now }
        }
    ],
    // YENİ EKLENEN KISIM: Ürünün Sahibi (Etiket)
    owner: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    }
});

module.exports = mongoose.model('Product', ProductSchema);