import React, { useState, useRef, useEffect } from 'react';

// Gerekli kütüphaneleri projenize dahil etmeniz gerekmektedir.
// Bu örnekte, CDN üzerinden script'leri dinamik olarak yüklüyoruz.
const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
// Hata veren CDN adresi yerine cdnjs adresi ile değiştirildi.
const HTML5_QRCODE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';

// Yardımcı Fonksiyon: Script'leri yüklemek için
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Script load error for ${src}`));
    document.head.appendChild(script);
  });
};

// TCKN Doğrulama Fonksiyonu
const validateTCKN = (tckn) => {
    if (typeof tckn !== 'string' || !/^[1-9][0-9]{10}$/.test(tckn)) {
        return false;
    }
    const digits = tckn.split('').map(Number);
    const t_tek = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
    const t_cift = digits[1] + digits[3] + digits[5] + digits[7];
    let d10_check = ((t_tek * 7) - t_cift) % 10;
    if (d10_check < 0) d10_check += 10;
    if (digits[9] !== d10_check) return false;
    const t10_toplam = digits.slice(0, 10).reduce((a, b) => a + b, 0);
    const d11_check = t10_toplam % 10;
    return digits[10] === d11_check;
};

// Doğum Tarihi Doğrulama ve Yaş Kontrolü Fonksiyonu
const validateAndCheckAge = (dobString) => {
    const parts = dobString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!parts) return { isValid: false, isUnder18: false, error: "Tarih formatı GG.AA.YYYY olmalıdır." };
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10);
    const year = parseInt(parts[3], 10);
    if (year < 1920) return { isValid: false, isUnder18: false, error: "Doğum yılı 1920'den küçük olamaz." };
    const dob = new Date(year, month - 1, day);
    if (dob.getFullYear() !== year || dob.getMonth() !== month - 1 || dob.getDate() !== day) {
        return { isValid: false, isUnder18: false, error: "Geçersiz tarih girdiniz." };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dob > today) return { isValid: false, isUnder18: false, error: "İleri bir tarih girilemez." };
    const ageLimit = new Date();
    ageLimit.setFullYear(ageLimit.getFullYear() - 18);
    return { isValid: true, isUnder18: dob > ageLimit, error: "" };
};

// ICAO 9303 Uzman MRZ Analiz Motoru
const mrzSpecialistParser = (rawOcrText) => {
    const charToValue = (char) => {
        if (char >= '0' && char <= '9') return parseInt(char, 10);
        if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55;
        return 0; // '<'
    };

    const calculateCheckDigit = (data) => {
        const weights = [7, 3, 1];
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += charToValue(data[i]) * weights[i % 3];
        }
        return sum % 10;
    };
    
    const transliterate = { 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U' };
    let lines = rawOcrText.toUpperCase().split('\n');
    let substitutions = [];
    
    let canonicalLines = lines.map((line) => {
        let l = line.replace(/[ÇĞİÖŞÜ]/g, match => transliterate[match]);
        l = l.replace(/\s/g, '<');
        l = l.replace(/[^A-Z0-9<]/g, '');
        if (l.length > 30) l = l.substring(0, 30);
        else if (l.length < 30) l = l.padEnd(30, '<');
        return l;
    }).filter(line => line.length === 30);

    if (canonicalLines.length < 2) {
        return { mrz_lines: canonicalLines, status: 'FORMAT_MISMATCH', checks: {}, parsed: {} };
    }
    
    const ocrCorrections = (lineStr, lineIndex) => {
        return lineStr.split('').map((char, charIndex) => {
            const pos = { line: lineIndex + 1, index: charIndex + 1 };
            if (lineIndex === 1 && ((pos.index >= 1 && pos.index <= 10) || (pos.index >= 14 && pos.index <= 20) || (pos.index >= 22 && pos.index <= 28))) {
                if (char === 'O') { substitutions.push({pos, from: 'O', to: '0', reason: 'digit expected'}); return '0'; }
                if (char === 'I' || char === 'L') { substitutions.push({pos, from: char, to: '1', reason: 'digit expected'}); return '1'; }
                if (char === 'B') { substitutions.push({pos, from: 'B', to: '8', reason: 'digit expected'}); return '8'; }
            }
            return char;
        }).join('');
    };
    
    canonicalLines = canonicalLines.map(ocrCorrections);
    const [line1, line2] = canonicalLines;
    const line3 = canonicalLines.length > 2 ? canonicalLines[2] : ''.padEnd(30, '<');
    
    const nameParts = line1.substring(5).split('<<');
    const docNum = line2.substring(0, 9);
    const docNumCheck = line2.substring(9, 10);
    const dob = line2.substring(13, 19);
    const dobCheck = line2.substring(19, 20);
    const expiry = line2.substring(21, 27);
    const expiryCheck = line2.substring(27, 28);
    const optionalData = line2.substring(28, 30) + line3;

    const formatYYMMDD = (yymmdd) => {
        if (!/^\d{6}$/.test(yymmdd)) return 'Invalid Date';
        let year = parseInt(yymmdd.substring(0, 2), 10);
        const currentYearYY = new Date().getFullYear() % 100;
        year += (year > currentYearYY + 5) ? 1900 : 2000;
        return `${year}-${yymmdd.substring(2, 4)}-${yymmdd.substring(4, 6)}`;
    };

    const parsed = {
        document_code: line1.substring(0, 1),
        document_type: line1.substring(1, 2),
        issuing_state: line1.substring(2, 5),
        surname: nameParts[0]?.replace(/<+$/, ''),
        given_names: nameParts[1]?.replace(/<+$/, ''),
        document_number: docNum,
        nationality: line2.substring(10, 13),
        date_of_birth: formatYYMMDD(dob),
        sex: line2.substring(20, 21),
        date_of_expiry: formatYYMMDD(expiry),
        optional_data: optionalData.replace(/<+$/, ''),
    };

    const docNumComputed = calculateCheckDigit(docNum);
    const dobComputed = calculateCheckDigit(dob);
    const expiryComputed = calculateCheckDigit(expiry);

    const checks = {
        document_number: { found: docNumCheck, computed: docNumComputed.toString(), valid: docNumCheck === docNumComputed.toString() },
        dob: { found: dobCheck, computed: dobComputed.toString(), valid: dobCheck === dobComputed.toString() },
        expiry: { found: expiryCheck, computed: expiryComputed.toString(), valid: expiryCheck === expiryComputed.toString() },
    };

    const allChecksValid = checks.document_number.valid && checks.dob.valid && checks.expiry.valid;

    return {
        mrz_lines: canonicalLines,
        parsed,
        checks,
        substitutions,
        status: allChecksValid ? 'OK' : 'CHECKSUM_FAILURE',
    };
};

const DeveloperCredit = () => {
    return (
        <a
            href="https://www.ismailkaraca.com.tr/"
            target="_blank"
            rel="noopener noreferrer"
            className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-white px-4 py-2 text-xs text-gray-700 shadow-lg transition-shadow hover:shadow-xl"
        >
            <img
                src="https://www.ismailkaraca.com.tr/wp-content/uploads/2025/03/ismail1002025.svg"
                alt="İsmail Karaca Logo"
                className="h-8 w-8 rounded-full"
                onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/32x32/eeeeee/333333?text=IK'; }}
            />
            <span className="font-medium hidden sm:inline">
                Geliştirici: İsmail Karaca | Geri bildirim için tıklayın.
            </span>
            <span className="font-medium sm:hidden">
                Geliştirici: İsmail Karaca
            </span>
        </a>
    );
};

// Ana uygulama bileşeni
export default function App() {
  const [scannedData, setScannedData] = useState([]);
  const [error, setError] = useState('');
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [manualTckn, setManualTckn] = useState('');
  const [manualDob, setManualDob] = useState('');
  const [manualTel, setManualTel] = useState('');
  const [manualVeliTel, setManualVeliTel] = useState('');
  const [tcknError, setTcknError] = useState('');
  const [dobError, setDobError] = useState('');
  const [isVeliTelRequired, setIsVeliTelRequired] = useState(false);
  const [scannerInput, setScannerInput] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const dobInputRef = useRef(null);
  const datePickerRef = useRef(null);
  const scannerInputRef = useRef(null);
  const telInputRef = useRef(null);
  const veliTelInputRef = useRef(null);
  const html5QrCodeRef = useRef(null);

  useEffect(() => {
    Promise.all([loadScript(XLSX_CDN), loadScript(TAILWIND_CDN), loadScript(HTML5_QRCODE_CDN)])
    .then(() => {
        setLibsLoaded(true);
    })
    .catch(err => {
        console.error(err);
        setError('Gerekli kütüphaneler yüklenemedi. İnternet bağlantınızı kontrol edin.');
    });
  }, []);

  const parseBarcode = (text) => {
    let tckn = null, dob = null;
    // TCKN: 11 haneli, 0 ile başlamayan sayı
    const tcknMatch = text.match(/\b([1-9][0-9]{10})\b/);
    if (tcknMatch) tckn = tcknMatch[1];
    
    // DOB: GG.AA.YYYY veya GGAA YYYY formatlarını arayabiliriz
    // Bu regex GG.AA.YYYY, GG/AA/YYYY, GG-AA-YYYY, G GAA YYYY, G.G.AAAA vb. yakalamaya çalışır
    // Daha spesifik bir regex: (GG.AA.YYYY)
    let dobMatch = text.match(/(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.((19|20)\d{2})\b/);
    if (dobMatch) {
      dob = `${dobMatch[1]}.${dobMatch[2]}.${dobMatch[3]}`;
    } else {
      // Alternatif format (GGMMYYYY)
      dobMatch = text.match(/\b(0[1-9]|[12][0-9]|3[01])(0[1-9]|1[0-2])((19|20)\d{2})\b/);
      if (dobMatch && !tcknMatch) { // Eğer TCKN bulunamadıysa, bu 11 haneli bir TCKN olabilir
          // Bu basit kontrol, TCKN'nin yanlışlıkla tarih olarak alınmasını engellemeye çalışır
          // Daha karmaşık bir mantık gerekebilir.
          if(text.length > 20) { // Genellikle barkod verisi daha uzundur
             dob = `${dobMatch[1]}.${dobMatch[2]}.${dobMatch[3]}`;
          }
      } else if (dobMatch && tcknMatch && dobMatch[0] !== tcknMatch[0]) {
           dob = `${dobMatch[1]}.${dobMatch[2]}.${dobMatch[3]}`;
      }
    }

    return (tckn && dob) ? { TCKN: tckn, DogumTarihi: dob } : null;
  };
  
  const handleScanResult = (result) => {
    if (result && result.status === 'OK') {
        // MRZ'den gelen tarihi GG.AA.YYYY formatına çevir
        let dob = result.parsed.date_of_birth; // YYYY-MM-DD
        if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
            const parts = dob.split('-');
            dob = `${parts[2]}.${parts[1]}.${parts[0]}`;
        }

        const newData = { 
            TCKN: result.parsed.document_number.replace(/<+$/, ''), 
            DogumTarihi: dob 
        };

        if (!scannedData.some(item => item.TCKN === newData.TCKN)) {
            // setScannedData(prev => [...prev, newData]); // Veriyi listeye hemen ekleme
            setManualTckn(newData.TCKN);
            updateDob(newData.DogumTarihi);
            telInputRef.current?.focus();
        } else {
            setError('Bu kimlik daha önce eklendi.');
        }
    } else if (result && result.status === 'CHECKSUM_FAILURE') {
        setError('MRZ okundu fakat doğrulanamadı. Lütfen tekrar deneyin.');
    } else {
        setError('MRZ formatı geçersiz veya okuma hatası çok.');
    }
  };
  
  const processScannerInput = (text) => {
    if (!text || !text.trim()) return;
    setError(''); setTcknError('');
    
    // 1. MRZ Olarak İşlemeyi Dene
    const mrzResult = mrzSpecialistParser(text);
    if (mrzResult.status === 'OK' || mrzResult.status === 'CHECKSUM_FAILURE') {
        handleScanResult(mrzResult);
        setScannerInput(''); 
        return;
    }

    // 2. Barkod Olarak İşlemeyi Dene (TCKN ve DOB içeren)
    const barcodeResult = parseBarcode(text);
    if (barcodeResult) {
        if (!scannedData.some(item => item.TCKN === barcodeResult.TCKN)) {
            // setScannedData(prev => [...prev, barcodeResult]); // Veriyi listeye hemen ekleme
            setManualTckn(barcodeResult.TCKN);
            updateDob(barcodeResult.DogumTarihi);
            telInputRef.current?.focus();
        } else { 
            setError('Bu kimlik daha önce eklendi.'); 
        }
        setScannerInput(''); 
        return;
    }

    // 3. Sadece TCKN Olarak İşlemeyi Dene
    const cleanedText = text.trim();
    if (validateTCKN(cleanedText)) {
        setManualTckn(cleanedText);
        setManualDob('');
        dobInputRef.current?.focus();
        setScannerInput(''); 
        return;
    }

    // 4. Başarısız
    setError('Okunan veri anlaşılamadı veya eksik bilgi içeriyor. (MRZ, Barkod veya TCKN formatı bulunamadı)');
  };

  const handleScannerInputKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        processScannerInput(e.target.value); 
    }
  };

  const handleManualAdd = () => {
    setError(''); setTcknError(''); setDobError('');
    if (scannedData.some(item => item.TCKN === manualTckn)) { 
        setError('Bu kimlik daha önce eklendi.'); 
        return; 
    }
    const newData = { TCKN: manualTckn, DogumTarihi: manualDob, Telefon: manualTel };
    if (isVeliTelRequired) newData.VeliTelefon = manualVeliTel;
    
    setScannedData(prev => [...prev, newData]);
    
    // Formu temizle
    setManualTckn(''); 
    setManualDob(''); 
    setManualVeliTel(''); 
    setManualTel(''); 
    setIsVeliTelRequired(false);
    setTcknError('');
    setDobError('');
    scannerInputRef.current?.focus(); // Bir sonraki tarama için okuyucuya odaklan
  };
  
  const handleExternalScannerClick = () => scannerInputRef.current?.focus();
  
  const handleTcknChange = (e) => {
      const value = e.target.value.replace(/\D/g, '');
      setManualTckn(value);
      setError(''); setTcknError('');
      if (value.length === 11) {
          if (validateTCKN(value)) {
              dobInputRef.current.focus();
          } else {
              setTcknError('TC yanlıştır lütfen kontrol ediniz');
          }
      }
  };

  const handleDobFocus = () => {
    // Mobil cihazlarda gereksiz takvim açılmasını engelle
    if (dobInputRef.current && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
       // dobInputRef.current.blur(); // Odağı hemen kaldır
       // Mobil cihazlarda da manuel girişe izin ver, takvimi zorlama
    } else if (datePickerRef.current && !manualDob) {
       // Masaüstünde takvimi açmayı dene
       try {
           // datePickerRef.current.showPicker(); // Otomatik açma bazen can sıkıcı olabilir, kapatalım.
           console.log("Tarih alanı odaklandı, masaüstü.");
       } catch (e) {
           // showPicker() her tarayıcıda desteklenmeyebilir
           console.log("showPicker() desteklenmiyor.");
       }
    }
  };

  const updateDob = (dobString) => {
    setManualDob(dobString);
    setDobError('');
    setIsVeliTelRequired(false);
    if (dobString.length === 10) {
        const validation = validateAndCheckAge(dobString);
        if (!validation.isValid) {
            setDobError(validation.error);
        }
        else {
          setIsVeliTelRequired(validation.isUnder18);
          telInputRef.current?.focus();
        }
    }
  };

  const handleDobChange = (e) => {
      let value = e.target.value.replace(/[^\d]/g, '');
      if (value.length > 2) value = `${value.substring(0, 2)}.${value.substring(2)}`;
      if (value.length > 5) value = `${value.substring(0, 5)}.${value.substring(5, 9)}`;
      updateDob(value.substring(0, 10)); // Maksimum 10 karakter (GG.AA.YYYY)
  };

  const handleDateSelect = (e) => {
      if (e.target.value) {
          const [year, month, day] = e.target.value.split('-');
          updateDob(`${day}.${month}.${year}`);
      }
  };

  const handleTelChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.startsWith('0')) {
      value = value.substring(1);
    }
    let formatted = '';
    if (value.length > 0) formatted = `(${value.substring(0, 3)}`;
    if (value.length > 3) formatted += `) ${value.substring(3, 6)}`;
    if (value.length > 6) formatted += ` ${value.substring(6, 8)}`;
    if (value.length > 8) formatted += ` ${value.substring(8, 10)}`;
    setManualTel(formatted.substring(0, 15)); // Maksimum 15 karakter

    if (formatted.length === 15 && isVeliTelRequired) {
      veliTelInputRef.current?.focus();
    }
  };

  const handleVeliTelChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.startsWith('0')) {
      value = value.substring(1);
    }
    let formatted = '';
    if (value.length > 0) formatted = `(${value.substring(0, 3)}`;
    if (value.length > 3) formatted += `) ${value.substring(3, 6)}`;
    if (value.length > 6) formatted += ` ${value.substring(6, 8)}`;
    if (value.length > 8) formatted += ` ${value.substring(8, 10)}`;
    setManualVeliTel(formatted.substring(0, 15)); // Maksimum 15 karakter
  };

  const handleDobKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      telInputRef.current?.focus();
    }
  };

  const handleTelKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isVeliTelRequired) {
        veliTelInputRef.current?.focus();
      } else if (!isAddButtonDisabled) {
        handleManualAdd();
      }
    }
  };

  const handleVeliTelKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isAddButtonDisabled) {
        handleManualAdd();
      }
    }
  };

  // --- YENİ FONKSİYONLAR: Kamera Tarayıcı ---
  const startScanner = async () => {
    if (!window.Html5Qrcode) {
        setError('Kamera tarayıcı kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }
    
    // Tarayıcı zaten açıksa tekrar açma
    if (isScannerOpen || html5QrCodeRef.current) {
        return;
    }

    setIsScannerOpen(true);
    setCameraError('');

    try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length) {
            // Arka kamerayı bulmaya çalış
            let cameraId = devices[0].id; // Varsayılan olarak ilk kamera
            const backCamera = devices.find(device => 
                device.label.toLowerCase().includes('back') || 
                device.label.toLowerCase().includes('arka')
            );
            if (backCamera) {
                cameraId = backCamera.id;
            }
            
            // "reader" ID'li element DOM'a eklendikten sonra başlat
            setTimeout(() => {
                try {
                    const html5QrCode = new Html5Qrcode("reader");
                    html5QrCodeRef.current = html5QrCode;
                    
                    html5QrCode.start(
                        cameraId, 
                        {
                            fps: 10,    // Saniyedeki kare sayısı
                            qrbox: (viewfinderWidth, viewfinderHeight) => {
                                // Tarama kutusunu ayarla (daha geniş, daha az yüksek)
                                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                                const boxSize = Math.floor(minEdge * 0.7);
                                return { width: boxSize * 1.5, height: boxSize * 0.8 }; // Barkod için daha uygun
                            }
                        },
                        (decodedText, decodedResult) => {
                            // --- Tarama Başarılı ---
                            console.log(`Okunan kod = ${decodedText}`, decodedResult);
                            
                            // Başarılı okumada titret
                            if (navigator.vibrate) {
                                navigator.vibrate(200);
                            }
                            
                            // Mevcut process fonksiyonunu kullanarak veriyi işle
                            processScannerInput(decodedText);
                            
                            // Tarayıcıyı durdur
                            stopScanner();
                        },
                        (errorMessage) => {
                            // --- Tarama Hatası (sürekli ateşlenir) ---
                            // console.warn(`Kod tarama hatası = ${errorMessage}`);
                        }
                    ).catch(err => {
                         console.error("Kamera .start() hatası:", err);
                         setCameraError("Kamera başlatılamadı. " + err.message);
                         setIsScannerOpen(false);
                    });
                } catch (e) {
                     console.error("Html5Qrcode başlatma hatası:", e);
                     setCameraError("Kamera tarayıcı nesnesi oluşturulamadı. " + e.message);
                     setIsScannerOpen(false);
                }
            }, 100); // DOM'un güncellenmesi için kısa bir gecikme

        } else {
            setCameraError('Kamera bulunamadı. Lütfen tarayıcı ayarlarından kamera izni verdiğinizden emin olun.');
            setIsScannerOpen(false);
        }
    } catch (err) {
        console.error("Kamera alınamadı (getCameras):", err);
        let userMessage = 'Kamera listesi alınamadı. ';
        if (err.name === "NotAllowedError" || err.message.includes("Permission denied")) {
            userMessage += 'Lütfen sayfa için kamera izinlerini kontrol edin.';
        } else {
            userMessage += err.message;
        }
        setCameraError(userMessage);
        setIsScannerOpen(false); // Başlatma başarısız olursa modalı kapat
    }
  };

  const stopScanner = () => {
    if (html5QrCodeRef.current) {
        try {
             // Sadece 'SCANNING' durumundaysa durdurmayı dene
            if (html5QrCodeRef.current.getState() === 2) { // 2 = SCANNING
                html5QrCodeRef.current.stop().then(() => {
                    console.log("Tarayıcı durduruldu.");
                }).catch(err => {
                    console.error("Tarayıcı düzgün durdurulamadı.", err);
                });
            }
        } catch(e) {
            console.error("Tarayıcı durdurulurken hata:", e);
        } finally {
            html5QrCodeRef.current = null;
            setIsScannerOpen(false);
        }
    } else {
        setIsScannerOpen(false); // Zaten kapalıysa state'i güncelle
    }
  };
  // --- YENİ FONKSİYONLAR SONU ---


  const exportToExcel = () => {
    if (scannedData.length === 0) { setError('Dışa aktarılacak veri bulunmuyor.'); return; }
    if (typeof window.XLSX === 'undefined') {
        setError('Excel kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.');
        return;
    }
    const dataForExport = scannedData.map(item => ({
        'T.C. Kimlik Numarası': item.TCKN,
        'Doğum Tarihi': item.DogumTarihi,
        'Telefon No': item.Telefon ? item.Telefon.replace(/\D/g, '') : '',
        'Veli Telefon No': item.VeliTelefon ? item.VeliTelefon.replace(/\D/g, '') : ''
    }));
    const worksheet = window.XLSX.utils.json_to_sheet(dataForExport);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Kimlik Bilgileri');
    window.XLSX.writeFile(workbook, 'Kimlik_Bilgileri_Listesi.xlsx');
  };
  const handleDelete = (tcknToDelete) => {
    setScannedData(prev => prev.filter(item => item.TCKN !== tcknToDelete));
  };

  const isTcknValid = validateTCKN(manualTckn);
  const isDobValid = /^\d{2}\.\d{2}\.\d{4}$/.test(manualDob) && !dobError;
  const isTelValid = manualTel.length === 15;
  const isVeliTelValid = manualVeliTel.length === 15;
  
  // Ekle butonunun aktiflik durumu
  const isAddButtonDisabled = 
    !isTcknValid || 
    !isDobValid || 
    (isVeliTelRequired && !isVeliTelValid) || // 18 altıysa Veli Tel zorunlu
    (!isVeliTelRequired && !isTelValid); // 18 üstüyse normal Tel zorunlu


  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col items-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-indigo-600">Kimlik Bilgisi Okuma ve Aktarma</h1>
            <p className="text-gray-600 mt-2">Harici MRZ okuyucu kullanarak veya manuel olarak kimlik bilgilerini girin.</p>
            <p className="text-orange-600 text-sm mt-2 font-semibold">Tüm işlemler cihazınızda yapılır. Hiçbir veri sunucuya gönderilmez (KVKK Uyumlu).</p>
        </header>
        {!libsLoaded && <div className="text-center p-4 bg-blue-100 text-blue-700 rounded-lg">Kütüphaneler yükleniyor...</div>}
        {libsLoaded && (
        <main className="flex flex-col md:flex-row gap-8">
          {/* Sol Panel: Veri Girişi */}
          <div className="flex-1 bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-xl font-semibold mb-4 text-center text-gray-700">Veri Girişi</h3>
            
            {/* Harici Okuyucu Bölümü */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <label className="block text-md font-medium text-gray-700 mb-2">Harici MRZ / Barkod Okuyucu</label>
              <p className="text-sm text-gray-500 mb-3">Okuyucuyu aktif edin ve kimliği okutun. Veri (MRZ, Barkod veya TCKN) otomatik işlenecektir.</p>
              <button onClick={handleExternalScannerClick} className="w-full p-3 rounded-md font-semibold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors mb-2">Harici Okuyucuyu Aktif Et</button>
              
              {/* --- YENİ BUTON --- */}
              <button 
                onClick={startScanner} 
                disabled={isScannerOpen}
                className="w-full p-3 rounded-md font-semibold bg-teal-500 text-white hover:bg-teal-600 transition-colors mb-2 flex items-center justify-center gap-2 disabled:bg-gray-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zM11.5 1.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-2zM2 4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3A.5.5 0 0 0 2 4zm0 4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3A.5.5 0 0 0 2 8zm0 4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zm4 0a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zm4 0a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zm-4-4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zm4 0a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zm-4-4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5z"/>
                </svg>
                Telefon Kamerası ile Tara
              </button>
              {/* --- YENİ BUTON SONU --- */}
              
              <textarea 
                ref={scannerInputRef} 
                rows="3" 
                className="w-full p-2 rounded bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none font-mono" 
                placeholder="Tarama yapın, veri burada görünecek..." 
                value={scannerInput} 
                onChange={(e) => setScannerInput(e.target.value)} 
                onKeyDown={handleScannerInputKeydown}
              />
            </div>
            
            {/* Manuel Giriş Bölümü */}
            <div className="flex flex-col gap-4">
              <label className="block text-md font-medium text-gray-700">Veya Bilgileri Elle Girin:</label>
              <div>
                <input 
                  type="tel" 
                  placeholder="T.C. Kimlik Numarası" 
                  value={manualTckn} 
                  onChange={handleTcknChange} 
                  maxLength="11" 
                  className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900"
                />
                <p className="text-gray-500 text-xs mt-1">Hatasız giriş için kimlik arkasındaki barkodu okutmanız önerilir.</p>
                {tcknError && <p className="text-red-600 text-sm mt-1">{tcknError}</p>}
              </div>
                <div>
                  <div className="relative">
                    <input 
                      ref={dobInputRef} 
                      onFocus={handleDobFocus} 
                      type="text" 
                      placeholder="Doğum Tarihi (GG.AA.YYYY)" 
                      value={manualDob} 
                      onChange={handleDobChange} 
                      onKeyDown={handleDobKeyDown} 
                      maxLength="10" 
                      className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900 pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                    </div>
                    {/* Gizli tarih seçici */}
                    <input 
                      ref={datePickerRef} 
                      type="date" 
                      onChange={handleDateSelect} 
                      className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                      style={{zIndex: -1}} // Ekran okuyucular için erişilebilir ama görünmez
                      tabIndex={-1} // Tab ile erişilemez yap
                      aria-hidden="true" // Ekran okuyuculardan gizle (ana input zaten okunuyor)
                    />
                  </div>
                  {dobError && <p className="text-red-600 text-sm mt-1">{dobError}</p>}
                </div>
                <div>
                    <input 
                      ref={telInputRef} 
                      type="tel" 
                      placeholder="Telefon Numarası" 
                      value={manualTel} 
                      onChange={handleTelChange} 
                      onKeyDown={handleTelKeyDown} 
                      maxLength="15" 
                      className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900"
                    />
                    {isVeliTelRequired &&
                        <p className="text-indigo-600 text-xs mt-1">18 yaşından küçük, telefon numarası isteğe bağlıdır.</p>
                    }
                    <p className="text-gray-500 text-xs mt-1">Numarayı başında '0' olmadan giriniz: (5XX) XXX XX XX</p>
                </div>
                {isVeliTelRequired && (
                    <div>
                        <input 
                          ref={veliTelInputRef} 
                          type="tel" 
                          placeholder="Veli Telefon Numarası" 
                          value={manualVeliTel} 
                          onChange={handleVeliTelChange} 
                          onKeyDown={handleVeliTelKeyDown} 
                          maxLength="15" 
                          className="w-full p-2 rounded bg-white border border-orange-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 focus:outline-none text-gray-900"
                        />
                        <p className="text-orange-600 text-xs mt-1">18 yaşından küçük olduğu için veli telefonu gereklidir.</p>
                        <p className="text-gray-500 text-xs mt-1">Numarayı başında '0' olmadan giriniz: (5XX) XXX XX XX</p>
                    </div>
                )}
                <button onClick={handleManualAdd} disabled={isAddButtonDisabled} className="p-3 w-full rounded font-semibold transition-colors bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed">Ekle</button>
                <p className="text-gray-500 text-xs mt-2 text-center">Tüm zorunlu alanlar doldurulmadan buton aktif hale gelmeyecektir.</p>
              </div>
            {error && <p className="text-red-700 mt-4 text-center bg-red-100 border border-red-200 p-2 rounded">{error}</p>}
          </div>

          {/* Sağ Panel: Liste */}
          <div className="flex-1 bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h2 className="text-2xl font-bold mb-4 border-b border-gray-200 pb-2 text-indigo-600">Okunan Kimlik Bilgileri</h2>
            <div className="max-h-[30rem] overflow-y-auto">
              {scannedData.length === 0 ? (
                <p className="text-gray-500 text-center mt-8">Henüz veri yok.</p>
              ) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr>
                      <th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">T.C. Kimlik No</th>
                      <th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Doğum Tarihi</th>
                      <th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Telefon No</th>
                      <th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Veli Telefon No</th>
                      <th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scannedData.map((data, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="p-3 border-b border-gray-200 font-mono text-sm">{data.TCKN}</td>
                        <td className="p-3 border-b border-gray-200 font-mono text-sm">{data.DogumTarihi}</td>
                        <td className="p-3 border-b border-gray-200 font-mono text-sm">{data.Telefon || '-'}</td>
                        <td className="p-3 border-b border-gray-200 font-mono text-sm">{data.VeliTelefon || '-'}</td>
                        <td className="p-3 border-b border-gray-200 text-right">
                          <button onClick={() => handleDelete(data.TCKN)} className="text-gray-400 hover:text-red-600 text-xl font-bold leading-none px-2 rounded-full transition-colors">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <button onClick={exportToExcel} disabled={scannedData.length === 0} className="w-full mt-4 p-3 rounded-md font-bold text-lg bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">Excel'e Aktar</button>
          </div>
        </main>)}
      </div>

      {/* --- YENİ KAMERA MODALI --- */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black bg-opacity-75" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="text-lg font-semibold text-gray-800">Kamera Tarayıcı</h3>
                    <button onClick={stopScanner} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                </div>
                <div className="p-4">
                    <div id="reader" className="w-full rounded-md overflow-hidden bg-gray-200 aspect-video">
                        {/* Tarayıcı videosu buraya eklenecek */}
                    </div>
                    {cameraError && (
                        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md text-sm" role="alert">
                            <strong>Hata:</strong> {cameraError}
                        </div>
                    )}
                    <p className="text-gray-600 text-sm mt-4 text-center">
                        Lütfen kimliğinizin <strong>arkasındaki barkodu</strong> tarayıcı alanına hizalayın.
                    </p>
                </div>
                <div className="p-4 bg-gray-50 border-t rounded-b-lg text-right">
                    <button 
                        onClick={stopScanner} 
                        className="px-4 py-2 rounded-md font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                    >
                        Kapat
                    </button>
                </div>
            </div>
        </div>
      )}
      {/* --- YENİ KAMERA MODALI SONU --- */}

      <DeveloperCredit />
    </div>
  );
}

