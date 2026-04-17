# Kısa Proje Anlatımı

Merhaba, ben Group 2 adına projemizi tanıtıyorum. Bu çalışma, kısa dönem konaklama ilanları için geliştirilmiş bir yapay zeka destekli sohbet uygulamasıdır. Kullanıcılar doğal dille arama yapabiliyor, uygun ilanları listeleyebiliyor, rezervasyon oluşturabiliyor ve önceki rezervasyonları için yorum bırakabiliyor.

Uygulama üç katmandan oluşuyor: React tabanlı bir frontend, Node.js ile çalışan bir agent backend ve MCP server. Frontend kullanıcıdan mesajı alıyor, backend bu mesajı yapay zekaya ve araçlara yönlendiriyor, MCP server da ilan arama, booking ve review işlemlerini gerçek API uçlarına bağlıyor.

Bu projede özellikle çok adımlı konuşmaları desteklemek için session context kullandık. Böylece kullanıcı bir ilanı rezerve ettikten sonra, aynı oturumda “review my last booking” gibi bir mesajla doğrudan yorum bırakabiliyor.

# Test / Demo Akışı

Demo sırasında sırasıyla şu adımları göstereceğim:

1. Uygulamayı açıyorum ve ana ekranı gösteriyorum.
2. Önce ilan araması yapıyorum: `Show me available listings in Istanbul for 2 guests from 2026-06-05 to 2026-06-08`.
3. Gelen sonuçlardan bir ilan seçip rezervasyon oluşturuyorum: `Book listing 201 for Begum Bal from 2026-06-05 to 2026-06-08`.
4. Hemen ardından aynı rezervasyon için yorum bırakıyorum: `Review my last booking with 5 stars and comment: Great stay`.
5. Son olarak ekranda booking ID ve review ID çıktığını gösteriyorum.

Kısa kapanış cümlesi olarak şunu söyleyebilirim: Bu proje, doğal dil ile çalışan, çok adımlı booking akışını destekleyen ve hem canlı hem de demo modunda güvenli şekilde kullanılabilen bir AI agent uygulamasıdır.