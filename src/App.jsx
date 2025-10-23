import React, { useState, useRef, useEffect } from 'react';

// Gerekli kütüphaneleri projenize dahil etmeniz gerekmektedir.
const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';

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
        document_number_check: docNumCheck,
        nationality: line2.substring(10, 13),
        date_of_birth: dob,
        date_of_birth_check: dobCheck,
        sex: line2.substring(20, 21),
        date_of_expiry: expiry,
        date_of_expiry_check: expiryCheck,
        optional_data: optionalData,
        formatted_dob: formatYYMMDD(dob),
        formatted_expiry: formatYYMMDD(expiry)
    };

    const checks = {
        docNumCheck: calculateCheckDigit(docNum) === parseInt(docNumCheck, 10),
        dobCheck: calculateCheckDigit(dob) === parseInt(dobCheck, 10),
        expiryCheck: calculateCheckDigit(expiry) === parseInt(expiryCheck, 10),
        optionalDataCheck: calculateCheckDigit(optionalData) === parseInt(line2.substring(28, 29), 10),
        compositeCheck: calculateCheckDigit(line2.substring(0, 10) + dob + expiry + optionalData) === parseInt(line2.substring(29, 30), 10)
    };

    return {
        mrz_lines: canonicalLines,
        status: Object.values(checks).every(c => c) ? 'VALID' : 'CHECK_FAILED',
        checks,
        substitutions,
        parsed
    };
};

const CameraScanner = ({ onDataExtracted, onClose }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const [cameraActive, setCameraActive] = useState(false);
    const [scanning, setScanning] = useState(false);
    const streamRef = useRef(null);
    const [recognizing, setRecognizing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Kamera açılıyor...');
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualMrzText, setManualMrzText] = useState('');

    useEffect(() => {
        // Kamera başlat
        startCamera();

        return () => {
            stopCamera();
        };
    }, []);

    const startCamera = async () => {
        try {
            setStatusMessage('Kamera erişimi isteniyor...');
            
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
                setCameraActive(true);
                setStatusMessage('Kimlik kartının MRZ bölümünü görüntüye alın');
            }
        } catch (err) {
            console.error('Kamera hatası:', err);
            setStatusMessage('Kamera başlatılamadı. Manuel giriş kullanın.');
            setShowManualInput(true);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            setCameraActive(false);
        }
    };

    const captureAndProcess = async () => {
        if (!videoRef.current || !canvasRef.current || recognizing) return;
        
        setRecognizing(true);
        setStatusMessage('Fotoğraf çekiliyor...');

        try {
            const context = canvasRef.current.getContext('2d');
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            context.drawImage(videoRef.current, 0, 0);
            
            // Görüntü verilerini al
            const imageData = canvasRef.current.toDataURL('image/jpeg');
            
            setStatusMessage('Metin tanınıyor (Tesseract)...');
            
            // Tesseract OCR kullanma
            if (typeof Tesseract !== 'undefined' && Tesseract.recognize) {
                try {
                    const result = await Tesseract.recognize(imageData, 'tur+eng');
                    const extractedText = result.data.text;
                    processMRZText(extractedText);
                } catch (ocrErr) {
                    console.error('OCR hatası:', ocrErr);
                    setStatusMessage('Tesseract hatası, manuel giriş kullanın.');
                    setShowManualInput(true);
                }
            } else {
                setStatusMessage('Tesseract yüklenemedi. Manuel giriş kullanın.');
                setShowManualInput(true);
            }
        } catch (error) {
            console.error('İşlem hatası:', error);
            setStatusMessage('Hata oluştu. Manuel giriş kullanın.');
            setShowManualInput(true);
        } finally {
            setRecognizing(false);
        }
    };

    const processMRZText = (extractedText) => {
        try {
            setStatusMessage('MRZ analiz ediliyor...');
            const mrzResult = mrzSpecialistParser(extractedText);

            if (mrzResult.status === 'VALID' && mrzResult.parsed.document_number) {
                const tckn = mrzResult.parsed.optional_data?.substring(0, 11) || '';
                const dobYYMMDD = mrzResult.parsed.date_of_birth;
                
                let dobFormatted = '';
                if (dobYYMMDD && dobYYMMDD.length === 6) {
                    const yy = dobYYMMDD.substring(0, 2);
                    const mm = dobYYMMDD.substring(2, 4);
                    const dd = dobYYMMDD.substring(4, 6);
                    
                    let year = parseInt(yy, 10);
                    const currentYearYY = new Date().getFullYear() % 100;
                    year += (year > currentYearYY + 5) ? 1900 : 2000;
                    
                    dobFormatted = `${dd}.${mm}.${year}`;
                }

                if (validateTCKN(tckn)) {
                    onDataExtracted({
                        tckn,
                        dob: dobFormatted
                    });
                    setStatusMessage('✅ Başarıyla okundu!');
                    setTimeout(() => onClose(), 1500);
                } else {
                    setStatusMessage('❌ Geçerli TCKN bulunamadı. Tekrar deneyin.');
                }
            } else {
                setStatusMessage('❌ MRZ formatı tanınamadı. Manuel giriş kullanın.');
                setShowManualInput(true);
            }
        } catch (error) {
            console.error('MRZ analiz hatası:', error);
            setStatusMessage('MRZ analizi başarısız. Manuel giriş kullanın.');
            setShowManualInput(true);
        }
    };

    const handleManualMrzSubmit = () => {
        if (manualMrzText.trim()) {
            processMRZText(manualMrzText);
        } else {
            setStatusMessage('Lütfen MRZ metnini girin.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full">
                <div className="p-4 bg-indigo-600 text-white flex justify-between items-center rounded-t-lg">
                    <h2 className="text-xl font-bold">Kamera ile MRZ Okuma</h2>
                    <button onClick={onClose} className="text-2xl font-bold leading-none hover:opacity-70">&times;</button>
                </div>
                
                <div className="p-6">
                    {!showManualInput ? (
                        <>
                            <div className="mb-4 text-center text-sm text-gray-600 bg-blue-50 p-3 rounded">
                                <p className="font-semibold">Talimat:</p>
                                <p>Kimlik kartının arkasındaki MRZ (Machine Readable Zone) bölümünü kamera görüntüsüne alın</p>
                            </div>

                            <div className="relative bg-black rounded-lg overflow-hidden mb-4" style={{ aspectRatio: '4/3' }}>
                                {cameraActive && (
                                    <>
                                        <video 
                                            ref={videoRef} 
                                            className="w-full h-full object-cover" 
                                            autoPlay 
                                            playsInline
                                            muted
                                        />
                                        <div className="absolute inset-0 border-4 border-green-500 opacity-50"></div>
                                    </>
                                )}
                                {!cameraActive && (
                                    <div className="w-full h-full flex items-center justify-center text-white">
                                        <div className="text-center">
                                            <div className="text-4xl mb-2">📷</div>
                                            <p className="text-sm">{statusMessage}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <canvas ref={canvasRef} className="hidden" />

                            <div className="text-center mb-4 text-sm text-gray-700 bg-gray-50 p-3 rounded">
                                <p className="font-semibold">{statusMessage}</p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={captureAndProcess}
                                    disabled={!cameraActive || recognizing}
                                    className="flex-1 p-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-400 transition-colors"
                                >
                                    {recognizing ? '⏳ İşleniyor...' : '📸 Fotoğraf Çek & Oku'}
                                </button>
                                <button
                                    onClick={() => setShowManualInput(true)}
                                    className="flex-1 p-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors"
                                >
                                    ✍️ Elle Gir
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 p-3 bg-gray-400 text-white font-semibold rounded-lg hover:bg-gray-500 transition-colors"
                                >
                                    ✕ İptal Et
                                </button>
                            </div>

                            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                                <p className="font-semibold mb-2">❗ Kamera sorunları varsa:</p>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li>HTTPS bağlantısı kullanın</li>
                                    <li>Tarayıcı kamera izinlerini kontrol edin</li>
                                    <li>Başka uygulamadaki kamera kapatsın</li>
                                    <li>Manuel giriş seçeneğini kullanın</li>
                                </ul>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mb-4 text-center text-sm text-gray-600 bg-blue-50 p-3 rounded">
                                <p className="font-semibold">Manuel MRZ Giriş</p>
                                <p>Kimlik kartının MRZ bölümünden (iki satır) metni aşağıya kopyalayıp yapıştırın</p>
                            </div>

                            <textarea 
                                value={manualMrzText}
                                onChange={(e) => setManualMrzText(e.target.value)}
                                placeholder="MRZ metnini buraya yapıştırın (örneğin: P<TRKXXX...)"
                                className="w-full p-3 rounded border-2 border-gray-300 focus:border-indigo-500 focus:outline-none font-mono text-sm mb-4"
                                rows="5"
                            />

                            <div className="text-center mb-4 text-sm text-gray-700 bg-gray-50 p-3 rounded">
                                <p>{statusMessage}</p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleManualMrzSubmit}
                                    disabled={recognizing || !manualMrzText.trim()}
                                    className="flex-1 p-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-400 transition-colors"
                                >
                                    {recognizing ? '⏳ İşleniyor...' : '✓ Analiz Et'}
                                </button>
                                <button
                                    onClick={() => setShowManualInput(false)}
                                    className="flex-1 p-3 bg-gray-400 text-white font-semibold rounded-lg hover:bg-gray-500 transition-colors"
                                >
                                    ← Geri
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 p-3 bg-red-400 text-white font-semibold rounded-lg hover:bg-red-500 transition-colors"
                                >
                                    ✕ İptal Et
                                </button>
                            </div>

                            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                                <p className="font-semibold mb-2">ℹ️ MRZ Nedir?</p>
                                <p>Kimlik kartının arkasında iki satırlık bir metin bloğudur. Örnek:</p>
                                <code className="block bg-white p-2 rounded mt-2 text-xs">P&lt;TRKABCD123456&lt;0&lt;
850101M2508312TRK0000000&lt;&lt;00</code>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const DeveloperCredit = () => (
    <footer className="mt-8 text-center text-gray-500 text-xs">
        <p>Kimlik Bilgisi Okuma ve Aktarma Uygulaması | Kamera & MRZ Okuma Özelliği Eklenmiş</p>
    </footer>
);

const App = () => {
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [manualTckn, setManualTckn] = useState('');
  const [manualDob, setManualDob] = useState('');
  const [manualTel, setManualTel] = useState('');
  const [manualVeliTel, setManualVeliTel] = useState('');
  const [scannerInput, setScannerInput] = useState('');
  const [scannedData, setScannedData] = useState([]);
  const [error, setError] = useState('');
  const [tcknError, setTcknError] = useState('');
  const [dobError, setDobError] = useState('');
  const [isVeliTelRequired, setIsVeliTelRequired] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  
  const scannerInputRef = useRef(null);
  const dobInputRef = useRef(null);
  const datePickerRef = useRef(null);
  const telInputRef = useRef(null);
  const veliTelInputRef = useRef(null);

  useEffect(() => {
    const loadLibs = async () => {
      try {
        await loadScript(TAILWIND_CDN);
        await loadScript(XLSX_CDN);
        await loadScript(TESSERACT_CDN);
        setLibsLoaded(true);
      } catch (err) {
        setError('Kütüphaneler yüklenemedi: ' + err.message);
      }
    };
    loadLibs();
  }, []);

  const handleCameraData = (data) => {
    if (data.tckn) setManualTckn(data.tckn);
    if (data.dob) setManualDob(data.dob);
    setShowCameraScanner(false);
    telInputRef.current?.focus();
  };

  const handleExternalScannerClick = () => {
    scannerInputRef.current?.focus();
    setScannerInput('');
  };

  const handleTcknChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    setManualTckn(value);
    if (value.length === 11 && !validateTCKN(value)) {
      setTcknError('Geçersiz TCKN!');
    } else {
      setTcknError('');
    }
  };

  const handleDobChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length >= 2) value = value.substring(0, 2) + '.' + value.substring(2);
    if (value.length >= 5) value = value.substring(0, 5) + '.' + value.substring(5, 9);
    setManualDob(value);

    if (value.length === 10) {
      const validation = validateAndCheckAge(value);
      if (!validation.isValid) {
        setDobError(validation.error);
      } else {
        setDobError('');
        setIsVeliTelRequired(validation.isUnder18);
      }
    } else {
      setDobError('');
      setIsVeliTelRequired(false);
    }
  };

  const handleDateSelect = (e) => {
    const date = new Date(e.target.value);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const formattedDate = `${day}.${month}.${year}`;
    setManualDob(formattedDate);
    dobInputRef.current?.focus();
  };

  const handleDobFocus = () => {
    datePickerRef.current?.click();
  };

  const handleScannerInputKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const mrzData = scannerInput.trim();
      if (mrzData) {
        const mrzResult = mrzSpecialistParser(mrzData);
        if (mrzResult.parsed && mrzResult.parsed.document_number) {
          const tckn = mrzResult.parsed.optional_data?.substring(0, 11) || '';
          if (validateTCKN(tckn)) {
            setManualTckn(tckn);
            if (mrzResult.parsed.formatted_dob) {
              const [year, month, day] = mrzResult.parsed.formatted_dob.split('-');
              setManualDob(`${day}.${month}.${year}`);
            }
            setScannerInput('');
            telInputRef.current?.focus();
          }
        }
      }
    }
  };

  const handleManualAdd = () => {
    setError('');
    if (!isTcknValid) { setError('TCKN geçersiz.'); return; }
    if (!isDobValid) { setError('Doğum tarihi geçersiz.'); return; }
    if (isVeliTelRequired && !isVeliTelValid) { setError('Veli telefonu gerekli.'); return; }
    if (!isVeliTelRequired && !isTelValid) { setError('Telefon numarası geçersiz.'); return; }

    const existingData = scannedData.find(item => item.TCKN === manualTckn);
    if (existingData) { setError('Bu TCKN zaten eklenmiş.'); return; }

    const newData = {
      TCKN: manualTckn,
      DogumTarihi: manualDob,
      Telefon: !isVeliTelRequired ? manualTel : '',
      VeliTelefon: isVeliTelRequired ? manualVeliTel : ''
    };

    setScannedData([...scannedData, newData]);
    setManualTckn('');
    setManualDob('');
    setManualTel('');
    setManualVeliTel('');
    setIsVeliTelRequired(false);
    setTcknError('');
    setDobError('');
    scannerInputRef.current?.focus();
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
    setManualTel(formatted);
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
    setManualVeliTel(formatted);
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

  const exportToExcel = () => {
    if (scannedData.length === 0) { setError('Dışa aktarılacak veri bulunmuyor.'); return; }
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
  const isAddButtonDisabled = !isTcknValid || !isDobValid || (isVeliTelRequired && !isVeliTelValid) || (!isVeliTelRequired && !isTelValid);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col items-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-indigo-600">Kimlik Bilgisi Okuma ve Aktarma</h1>
            <p className="text-gray-600 mt-2">Harici MRZ okuyucu, kamera veya manuel olarak kimlik bilgilerini girin.</p>
            <p className="text-orange-600 text-sm mt-2 font-semibold">Tüm işlemler cihazınızda yapılır. Hiçbir veri sunucuya gönderilmez (KVKK Uyumlu).</p>
        </header>
        {!libsLoaded && <div className="text-center p-4 bg-blue-100 text-blue-700 rounded-lg">Kütüphaneler yükleniyor...</div>}
        {libsLoaded && (
        <main className="flex flex-col md:flex-row gap-8">
          <div className="flex-1 bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h3 className="text-xl font-semibold mb-4 text-center text-gray-700">Veri Girişi</h3>
            
            {/* Kamera Butonu */}
            <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <button 
                onClick={() => setShowCameraScanner(true)} 
                className="w-full p-3 rounded-md font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.219A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22a2 2 0 001.664.889H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Kamerada MRZ Oku
              </button>
              <p className="text-sm text-green-700 mt-2 text-center">Hızlı ve doğru okuma için kimlik kartının arkasını tarayın</p>
            </div>

            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <label className="block text-md font-medium text-gray-700 mb-2">Harici MRZ Okuyucu Kullanımı</label>
              <p className="text-sm text-gray-500 mb-3">Okuyucudan gelen veriyi aşağıdaki alana yapıştırın veya okutun. Enter tuşuna basıldığında veri işlenecektir.</p>
              <button onClick={handleExternalScannerClick} className="w-full p-3 rounded-md font-semibold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors mb-2">Okuyucuyu Aktif Et</button>
              <textarea ref={scannerInputRef} rows="3" className="w-full p-2 rounded bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none font-mono" placeholder="Tarama yapın, veri burada görünecek..." value={scannerInput} onChange={(e) => setScannerInput(e.target.value)} onKeyDown={handleScannerInputKeydown}/>
            </div>
            
            <div className="flex flex-col gap-4">
              <label className="block text-md font-medium text-gray-700">Veya Bilgileri Elle Girin:</label>
              <div>
                <input type="text" placeholder="T.C. Kimlik Numarası" value={manualTckn} onChange={handleTcknChange} maxLength="11" className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900"/>
                <p className="text-gray-500 text-xs mt-1">Doğru giriş için bir barkod okuyucu ile kimliğin arkasındaki barkodun okutulması önerilmektedir.</p>
                {tcknError && <p className="text-red-600 text-sm mt-1">{tcknError}</p>}
              </div>
                <div>
                  <div className="relative">
                    <input ref={dobInputRef} onFocus={handleDobFocus} type="text" placeholder="Doğum Tarihi (GG.AA.YYYY)" value={manualDob} onChange={handleDobChange} onKeyDown={handleDobKeyDown} maxLength="10" className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900 pr-10"/>
                    <div className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                    </div>
                    <input ref={datePickerRef} type="date" onChange={handleDateSelect} className="absolute inset-y-0 right-0 w-10 h-full opacity-0 cursor-pointer" aria-label="Tarih seç"/>
                  </div>
                  {dobError && <p className="text-red-600 text-sm mt-1">{dobError}</p>}
                </div>
                <div>
                    <input ref={telInputRef} type="text" placeholder="Telefon Numarası" value={manualTel} onChange={handleTelChange} onKeyDown={handleTelKeyDown} maxLength="15" className="w-full p-2 rounded bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-gray-900"/>
                    {isVeliTelRequired &&
                        <p className="text-indigo-600 text-xs mt-1">18 yaşından küçük olduğu için telefon numarası zorunlu değildir, isteğe bağlı olarak girilebilir.</p>
                    }
                    <p className="text-gray-500 text-xs mt-1">Numarayı başında '0' olmadan giriniz.</p>
                </div>
                {isVeliTelRequired && (
                    <div>
                        <input ref={veliTelInputRef} type="text" placeholder="Veli Telefon Numarası" value={manualVeliTel} onChange={handleVeliTelChange} onKeyDown={handleVeliTelKeyDown} maxLength="15" className="w-full p-2 rounded bg-white border border-orange-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 focus:outline-none text-gray-900"/>
                        <p className="text-orange-600 text-xs mt-1">18 yaşından küçük olduğu için veli telefonu gereklidir.</p>
                        <p className="text-gray-500 text-xs mt-1">Numarayı başında '0' olmadan giriniz.</p>
                    </div>
                )}
                <button onClick={handleManualAdd} disabled={isAddButtonDisabled} className="p-3 w-full rounded font-semibold transition-colors bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed">Ekle</button>
                <p className="text-gray-500 text-xs mt-2 text-center">Tüm zorunlu alanlar doldurulmadan buton aktif hale gelmeyecektir.</p>
              </div>
            {error && <p className="text-red-700 mt-4 text-center bg-red-100 border border-red-200 p-2 rounded">{error}</p>}
          </div>
          <div className="flex-1 bg-white p-6 rounded-lg shadow-md border border-gray-200"><h2 className="text-2xl font-bold mb-4 border-b border-gray-200 pb-2 text-indigo-600">Okunan Kimlik Bilgileri</h2>
            <div className="max-h-[30rem] overflow-y-auto">{scannedData.length === 0 ? (<p className="text-gray-500 text-center mt-8">Henüz veri yok.</p>) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-gray-50 z-10"><tr><th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">T.C. Kimlik No</th><th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Doğum Tarihi</th><th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Telefon No</th><th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200">Veli Telefon No</th><th className="p-3 text-sm font-semibold text-left text-gray-600 border-b-2 border-gray-200"></th></tr></thead>
                  <tbody>{scannedData.map((data, index) => (<tr key={index} className="hover:bg-gray-50"><td className="p-3 border-b border-gray-200 font-mono text-sm">{data.TCKN}</td><td className="p-3 border-b border-gray-200 font-mono text-sm">{data.DogumTarihi}</td><td className="p-3 border-b border-gray-200 font-mono text-sm">{data.Telefon || '-'}</td><td className="p-3 border-b border-gray-200 font-mono text-sm">{data.VeliTelefon || '-'}</td><td className="p-3 border-b border-gray-200 text-right"><button onClick={() => handleDelete(data.TCKN)} className="text-gray-400 hover:text-red-600 text-xl font-bold leading-none px-2 rounded-full transition-colors">&times;</button></td></tr>))}</tbody>
                </table>)}
            </div><button onClick={exportToExcel} disabled={scannedData.length === 0} className="w-full mt-4 p-3 rounded-md font-bold text-lg bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">Excel'e Aktar</button>
          </div>
        </main>)}
        
        {showCameraScanner && (
            <CameraScanner 
                onDataExtracted={handleCameraData}
                onClose={() => setShowCameraScanner(false)}
            />
        )}
      </div>
      <DeveloperCredit />
    </div>
  );
}

export default App;
