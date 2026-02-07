const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true }, // Kullanıcı Adı (Benzersiz olmalı)
    password: { type: String, required: true }  // Şifre
});

module.exports = mongoose.model('User', UserSchema);
