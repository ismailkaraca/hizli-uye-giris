import React, { useState, useRef, useEffect } from 'react';

// Gerekli kütüphaneleri projenize dahil etmeniz gerekmektedir.
// Bu örnekte, CDN üzerinden script'leri dinamik olarak yüklüyoruz.
const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';

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

  const dobInputRef = useRef(null);
  const datePickerRef = useRef(null);
  const scannerInputRef = useRef(null);
  const telInputRef = useRef(null);
  const veliTelInputRef = useRef(null);

  useEffect(() => {
    Promise.all([loadScript(XLSX_CDN), loadScript(TAILWIND_CDN)])
    .then(() => setLibsLoaded(true))
    .catch(err => {
        console.error(err);
        setError('Gerekli kütüphaneler yüklenemedi. İnternet bağlantınızı kontrol edin.');
    });
  }, []);

  const parseBarcode = (text) => {
    let tckn = null, dob = null;
    const tcknMatch = text.match(/\b([1-9][0-9]{10})\b/);
    if (tcknMatch) tckn = tcknMatch[1];
    const dobMatch = text.match(/(0[1-9]|[12][0-9]|3[01])(0[1-9]|1[0-2])((19|20)\d{2})/);
    if (dobMatch) dob = `${dobMatch[1]}.${dobMatch[2]}.${dobMatch[3]}`;
    return (tckn && dob) ? { TCKN: tckn, DogumTarihi: dob } : null;
  };
  
  const handleScanResult = (result) => {
    if (result && result.status === 'OK') {
        const newData = { TCKN: result.parsed.document_number.replace(/<+$/, ''), DogumTarihi: result.parsed.date_of_birth.replace(/-/g, '.') };
        if (!scannedData.some(item => item.TCKN === newData.TCKN)) {
            setScannedData(prev => [...prev, newData]);
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
    const mrzResult = mrzSpecialistParser(text);
    if (mrzResult.status === 'OK') {
        handleScanResult(mrzResult);
        setScannerInput(''); return;
    }
    const barcodeResult = parseBarcode(text);
    if (barcodeResult) {
        if (!scannedData.some(item => item.TCKN === barcodeResult.TCKN)) {
            setScannedData(prev => [...prev, barcodeResult]);
        } else { setError('Bu kimlik daha önce eklendi.'); }
        setScannerInput(''); return;
    }
    const cleanedText = text.trim();
    if (validateTCKN(cleanedText)) {
        setManualTckn(cleanedText);
        setManualDob('');
        dobInputRef.current?.focus();
        setScannerInput(''); return;
    }
    setError('Okunan veri anlaşılamadı veya eksik bilgi içeriyor.');
  };

  const handleScannerInputKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processScannerInput(e.target.value); }
  };

  const handleManualAdd = () => {
    setError(''); setTcknError(''); setDobError('');
    if (scannedData.some(item => item.TCKN === manualTckn)) { setError('Bu kimlik daha önce eklendi.'); return; }
    const newData = { TCKN: manualTckn, DogumTarihi: manualDob, Telefon: manualTel };
    if (isVeliTelRequired) newData.VeliTelefon = manualVeliTel;
    setScannedData(prev => [...prev, newData]);
    setManualTckn(''); setManualDob(''); setManualVeliTel(''); setManualTel(''); setIsVeliTelRequired(false);
  };
  
  const handleExternalScannerClick = () => scannerInputRef.current?.focus();
  const handleTcknChange = (e) => {
      const value = e.target.value.replace(/\D/g, '');
      setManualTckn(value);
      setError(''); setTcknError('');
      if (value.length === 11) {
          if (validateTCKN(value)) dobInputRef.current.focus();
          else setTcknError('TC yanlıştır lütfen kontrol ediniz');
      }
  };
  const handleDobFocus = () => {
    if (datePickerRef.current && !manualDob) {
        datePickerRef.current.click();
    }
  };
  const updateDob = (dobString) => {
    setManualDob(dobString);
    setDobError('');
    setIsVeliTelRequired(false);
    if (dobString.length === 10) {
        const validation = validateAndCheckAge(dobString);
        if (!validation.isValid) setDobError(validation.error);
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
      updateDob(value);
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
    setManualTel(formatted);

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
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-6"><h1 className="text-3xl md:text-4xl font-bold text-cyan-400">Kimlik Bilgisi Okuma ve Aktarma</h1><p className="text-gray-400 mt-2">Harici MRZ okuyucu kullanarak veya manuel olarak kimlik bilgilerini girin.</p><p className="text-yellow-500 text-sm mt-2 font-semibold">Tüm işlemler cihazınızda yapılır. Hiçbir veri sunucuya gönderilmez (KVKK Uyumlu).</p></header>
        {!libsLoaded && <div className="text-center p-4 bg-blue-900 rounded-lg">Kütüphaneler yükleniyor...</div>}
        {libsLoaded && (
        <main className="flex flex-col md:flex-row gap-8">
          <div className="flex-1 bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold mb-4 text-center text-gray-300">Veri Girişi</h3>
            <div className="mb-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
              <label className="block text-md font-medium text-gray-300 mb-2">Harici MRZ Okuyucu Kullanımı</label>
              <p className="text-sm text-gray-400 mb-3">Okuyucudan gelen veriyi aşağıdaki alana yapıştırın veya okutun. Enter tuşuna basıldığında veri işlenecektir.</p>
              <button onClick={handleExternalScannerClick} className="w-full p-3 rounded-md font-semibold bg-purple-600 hover:bg-purple-700 transition-colors mb-2">Okuyucuyu Aktif Et</button>
              <textarea ref={scannerInputRef} rows="3" className="w-full p-2 rounded bg-gray-600 border border-gray-500 focus:ring-2 focus:ring-purple-500 focus:outline-none text-white font-mono" placeholder="Tarama yapın, veri burada görünecek..." value={scannerInput} onChange={(e) => setScannerInput(e.target.value)} onKeyDown={handleScannerInputKeydown}/>
            </div>
            
            <div className="flex flex-col gap-3">
              <label className="block text-md font-medium text-gray-300">Veya Bilgileri Elle Girin:</label>
              <div>
                <input type="text" placeholder="T.C. Kimlik Numarası" value={manualTckn} onChange={handleTcknChange} maxLength="11" className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:outline-none text-white"/>
                <p className="text-gray-400 text-xs mt-1">Doğru giriş için bir barkod okuyucu ile kimliğin arkasındaki barkodun okutulması önerilmektedir.</p>
                {tcknError && <p className="text-red-400 text-sm mt-1">{tcknError}</p>}
              </div>
                <div>
                  <div className="relative">
                    <input ref={dobInputRef} onFocus={handleDobFocus} type="text" placeholder="Doğum Tarihi (GG.AA.YYYY)" value={manualDob} onChange={handleDobChange} onKeyDown={handleDobKeyDown} maxLength="10" className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:outline-none text-white pr-10"/>
                    <div className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                    </div>
                    <input ref={datePickerRef} type="date" onChange={handleDateSelect} className="absolute inset-y-0 right-0 w-10 h-full opacity-0 cursor-pointer" aria-label="Tarih seç"/>
                  </div>
                  {dobError && <p className="text-red-400 text-sm mt-1">{dobError}</p>}
                </div>
                <div>
                    <input ref={telInputRef} type="text" placeholder="Telefon Numarası" value={manualTel} onChange={handleTelChange} onKeyDown={handleTelKeyDown} maxLength="15" className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:outline-none text-white"/>
                    {isVeliTelRequired &&
                        <p className="text-cyan-400 text-xs mt-1">18 yaşından küçük olduğu için telefon numarası zorunlu değildir, isteğe bağlı olarak girilebilir.</p>
                    }
                    <p className="text-gray-400 text-xs mt-1">Numarayı başında '0' olmadan giriniz.</p>
                </div>
                {isVeliTelRequired && (
                    <div>
                        <input ref={veliTelInputRef} type="text" placeholder="Veli Telefon Numarası" value={manualVeliTel} onChange={handleVeliTelChange} onKeyDown={handleVeliTelKeyDown} maxLength="15" className="w-full p-2 rounded bg-gray-700 border border-yellow-500 focus:ring-2 focus:ring-yellow-400 focus:outline-none text-white"/>
                        <p className="text-yellow-500 text-xs mt-1">18 yaşından küçük olduğu için veli telefonu gereklidir.</p>
                        <p className="text-gray-400 text-xs mt-1">Numarayı başında '0' olmadan giriniz.</p>
                    </div>
                )}
                <button onClick={handleManualAdd} disabled={isAddButtonDisabled} className="p-3 w-full rounded font-semibold transition-colors bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed">Ekle</button>
                <p className="text-gray-400 text-xs mt-2 text-center">Tüm zorunlu alanlar doldurulmadan buton aktif hale gelmeyecektir.</p>
              </div>
            {error && <p className="text-red-400 mt-4 text-center bg-red-900/50 p-2 rounded">{error}</p>}
          </div>
          <div className="flex-1 bg-gray-800 p-4 rounded-lg shadow-lg"><h2 className="text-2xl font-bold mb-4 border-b border-gray-700 pb-2 text-cyan-400">Okunan Kimlik Bilgileri</h2>
            <div className="max-h-[30rem] overflow-y-auto">{scannedData.length === 0 ? (<p className="text-gray-400 text-center mt-8">Henüz veri yok.</p>) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-gray-800 z-10"><tr><th className="p-2 border-b border-gray-600">T.C. Kimlik Numarası</th><th className="p-2 border-b border-gray-600">Doğum Tarihi</th><th className="p-2 border-b border-gray-600">Telefon No</th><th className="p-2 border-b border-gray-600">Veli Telefon No</th><th className="p-2 border-b border-gray-600"></th></tr></thead>
                  <tbody>{scannedData.map((data, index) => (<tr key={index} className="hover:bg-gray-700"><td className="p-2 border-b border-gray-700 font-mono">{data.TCKN}</td><td className="p-2 border-b border-gray-700 font-mono">{data.DogumTarihi}</td><td className="p-2 border-b border-gray-700 font-mono">{data.Telefon || '-'}</td><td className="p-2 border-b border-gray-700 font-mono">{data.VeliTelefon || '-'}</td><td className="p-2 border-b border-gray-700 text-right"><button onClick={() => handleDelete(data.TCKN)} className="text-red-500 hover:text-red-400 text-xl font-bold leading-none px-2 rounded-full">&times;</button></td></tr>))}</tbody>
                </table>)}
            </div><button onClick={exportToExcel} disabled={scannedData.length === 0} className="w-full mt-4 p-3 rounded-md font-bold text-lg bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 disabled:cursor-not-allowed">Excel'e Aktar</button>
          </div>
        </main>)}
      </div>
    </div>
  );
}

