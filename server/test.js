// Manuel Test: Amazon'a gitmeden veri kaydetmeyi dene
fetch('http://localhost:3000/add-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        // Sahte bir link gönderiyoruz
        url: 'https://www.google.com' 
    })
})
.then(res => res.json())
.then(data => console.log("SONUÇ:", data))
.catch(err => console.error("HATA:", err));