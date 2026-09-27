# 🖼️ VLM Studio (Vision-Language Model Comparison Platform)

**VLM Studio**, farklı Görsel-Dil Modellerini (Vision-Language Models - VLM) tek bir arayüz üzerinden eşzamanlı olarak çalıştırmanıza, karşılaştırmanıza ve görsel analizi gerçekleştirmenize olanak tanıyan web tabanlı bir platformdur.

Ağır yapay zeka modellerini çoklu konteyner (multi-container) mimarisiyle izole bir şekilde yönetebilir, tek bir görsel yükleyerek farklı fine-tune edilmiş VLM mimarilerinin çıktılarını yan yana inceleyebilirsiniz.

---

## ✨ Öne Çıkan Özellikler

* **Çoklu Model Karşılaştırması:** Tek bir istem (prompt) ve görsel ile birden fazla VLM modelini (`Qwen`, `LLaVA`, `RSLLaVA` vb.) aynı anda sorgulayabilme.
* **Sohbet ve Oturum Yönetimi:** Yanıtları sohbet geçmişi olarak saklama, geçmiş sohbetler arasında geçiş yapma ve sohbet silme/temizleme işlevleri.
* **Görsel Yükleme ve Analiz:** PNG, JPG, WebP formatlarında uydu/hava fotoğrafları veya genel görselleri yükleyerek nesne/bölge tespiti ve görsel soru yanıtlama (VQA).
* **Esnek Konteyner Mimarisi:** Docker ve Docker Compose ile bağımsız model servislerini yönetme.
* **Kolay Çalıştırma Scriptleri:** `setup.sh`, `start.sh` ve `stop.sh` ile platformu tek komutla başlatıp durdurabilme.

---

## 🛠️ Teknolojiler ve Mimari

* **Backend:** Python, FastAPI, Uvicorn
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla JS), FontAwesome
* **Konteynerizasyon:** Docker, Docker Compose
* **Desteklenen Model Ailesi:** Qwen Vision, LLaVA, RSLLaVA ve özel fine-tune edilmiş ağırlıklar

---

## 📁 Proje Yapısı

```text
MultiContainerWebUI/
├── web_app/             # Web arayüzü ve API servisleri (FastAPI)
│   ├── static/          # CSS, JS ve ikon dosyaları
│   ├── index.html       # Ana arayüz şablonu
│   └── app.py           # FastAPI sunucusu
├── docker/              # Model konteyner yapılandırmaları
├── docker-compose.yml   # Çoklu konteyner orkestrasyonu
├── custom_models.json   # Özel model konfigürasyonları
├── families.json        # Model aileleri tanımları
├── setup.sh             # Ortam kurulum betiği
├── start.sh             # Servisleri başlatma betiği
└── stop.sh              # Servisleri durdurma betiği
```

---

## 🚀 Kurulum ve Çalıştırma

### Gereksinimler
* [Docker](https://www.docker.com/) & Docker Compose
* Python 3.10+ (Yerel çalıştırma için)
* Nvidia GPU & CUDA desteği (Önerilen)

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/keremilktan/VLM_Studio.git
cd VLM_Studio
```

### 2. Docker Compose ile Çalıştırma (Önerilen)
Konteyner ortamını kurup başlatmak için betikleri kullanabilirsiniz:

```bash
# Kurulumu gerçekleştirin
bash setup.sh

# Servisleri başlatın
bash start.sh
```

Alternatif olarak doğrudan Docker Compose komutunu çalıştırabilirsiniz:
```bash
docker-compose up -d
```

### 3. Manuel / Python ile Çalıştırma
Geliştirme ortamında doğrudan çalıştırmak isterseniz:

```bash
# Sanal ortam oluşturun ve aktif edin
python -m venv venv
source venv/bin/activate  # Linux/macOS
# veya Windows için: venv\Scripts\activate

# Gerekli bağımlılıkları yükleyin ve uygulamayı başlatın
python ./web_app/app.py
```

Tarayıcınızda **`http://localhost:8000`** veya **`http://127.0.0.1:8000`** adresine giderek arayüze erişebilirsiniz.

---

## 📝 Lisans

Bu proje açık kaynaklıdır. Detaylar için lisans dosyasına göz atabilirsiniz.