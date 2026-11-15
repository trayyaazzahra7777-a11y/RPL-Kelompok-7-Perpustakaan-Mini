console.log("NAMA ANGGOTA KELOMPOK 7:");
console.log("Trayya Azzahra Baso_F5512520100");
console.log("Rahmita Nurainun R. Hambali_F5512520083");
console.log("Syifa Inayah_F5512530104");
console.log("Safitri_F5512530119");

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- konfigurasi ----------
const PORT = process.env.PORT || 3000;
const OPENLIBRARY_URL = process.env.OPENLIBRARY_URL || 'https://openlibrary.org';
const USER_AGENT = 'perpustakaan-mini-kelompok7 (praktikum Rekayasa API, Universitas Tadulako)';
const BATAS_WAKTU_MS = 8000;      // batas tunggu pemanggilan Open Library
const BATAS_BODY = 1024 * 1024;   // ukuran body request maksimum (1 MB)
const MASA_PINJAM_HARI = 7;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE_BUKU = path.join(DATA_DIR, 'books.json');
const FILE_ANGGOTA = path.join(DATA_DIR, 'members.json');
const FILE_PINJAMAN = path.join(DATA_DIR, 'loans.json');

// ---------- helper respons ----------
function kirimJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function kirimError(res, statusCode, pesan) {
  kirimJSON(res, statusCode, { error: pesan });
}

function buatError(statusCode, pesan) {
  const err = new Error(pesan);
  err.statusCode = statusCode;
  return err;
}

// ---------- helper penyimpanan (file JSON melalui module fs) ----------
function siapkanPenyimpanan() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of [FILE_BUKU, FILE_ANGGOTA, FILE_PINJAMAN]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
  }
}

function bacaData(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function simpanData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// id baru = id terbesar + 1. Id pada daftar tambahan (misalnya bookId di loans)
// ikut dihitung agar id buku/anggota yang sudah dihapus tidak dipakai ulang
// dan riwayat peminjaman tidak menunjuk ke data yang salah.
function idBerikutnya(...daftarId) {
  let terbesar = 0;
  for (const daftar of daftarId) {
    for (const id of daftar) if (id > terbesar) terbesar = id;
  }
  return terbesar + 1;
}

// ---------- helper request ----------
function bacaBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > BATAS_BODY) {
        reject(buatError(413, 'Body request terlalu besar'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (body === '') return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(buatError(400, 'Body request bukan JSON yang valid'));
      }
    });
    req.on('error', reject);
  });
}

// Body untuk POST/PUT harus berupa objek JSON ({ ... }).
async function bacaBodyObjek(req) {
  const input = await bacaBody(req);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw buatError(400, 'Body request harus berupa objek JSON');
  }
  return input;
}

// id pada URL: hanya bilangan bulat positif tanpa awalan nol.
function ambilId(teks) {
  if (!/^[1-9]\d*$/.test(teks)) {
    throw buatError(400, 'id harus berupa bilangan bulat positif');
  }
  return Number(teks);
}

// ---------- helper validasi ----------
function teksValid(nilai) {
  return typeof nilai === 'string' && nilai.trim() !== '';
}

function normalisasiIsbn(teks) {
  return teks.replace(/[-\s]/g, '').toUpperCase();
}

// ISBN: 10 atau 13 karakter setelah tanda hubung dan spasi dihapus,
// hanya angka (karakter terakhir ISBN-10 boleh X).
function isbnValid(isbn) {
  return /^(\d{9}[\dX]|\d{13})$/.test(isbn);
}

function tahunValid(tahun) {
  return tahun === null ||
    (Number.isInteger(tahun) && tahun >= 0 && tahun <= new Date().getFullYear());
}

function idPositif(nilai) {
  return Number.isInteger(nilai) && nilai >= 1;
}

// ---------- integrasi public API: Open Library ----------
async function panggilOpenLibrary(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(BATAS_WAKTU_MS)
    });
  } catch (err) {
    throw buatError(502, 'Open Library tidak dapat dihubungi atau melewati batas waktu');
  }
  if (!res.ok) {
    throw buatError(502, `Open Library membalas dengan status ${res.status}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw buatError(502, 'Respons Open Library bukan JSON yang valid');
  }
}

// Mengambil year dari publish_date (string seperti "1996" atau "September 1, 1996").
function ambilTahun(teks) {
  const cocok = String(teks || '').match(/(?<!\d)(\d{4})(?!\d)/);
  if (!cocok) return null;
  const tahun = Number(cocok[1]);
  return tahunValid(tahun) ? tahun : null;
}

// Books API: satu buku berdasarkan ISBN -> { title, author, year }
async function ambilBukuDariOpenLibrary(isbn) {
  const kunci = `ISBN:${isbn}`;
  const url = `${OPENLIBRARY_URL}/api/books?bibkeys=${encodeURIComponent(kunci)}&format=json&jscmd=data`;
  const hasil = await panggilOpenLibrary(url);
  const data = hasil[kunci];
  if (!data || !teksValid(data.title)) {
    throw buatError(404, `ISBN ${isbn} tidak ditemukan di Open Library`);
  }
  const penulis = (data.authors || []).map((a) => a.name).filter(teksValid);
  return {
    title: data.title.trim(),
    author: penulis.length > 0 ? penulis.join(', ') : 'Tidak diketahui',
    year: ambilTahun(data.publish_date)
  };
}

// Search API: daftar ringkas, paling banyak 10 hasil
async function cariDiOpenLibrary(kataKunci) {
  const url = `${OPENLIBRARY_URL}/search.json?q=${encodeURIComponent(kataKunci)}` +
    '&fields=key,title,author_name,first_publish_year&limit=10';
  const hasil = await panggilOpenLibrary(url);
  const docs = Array.isArray(hasil.docs) ? hasil.docs : [];
  return docs.slice(0, 10).map((d) => ({
    key: d.key,
    title: d.title,
    author: Array.isArray(d.author_name) && d.author_name.length > 0
      ? d.author_name.join(', ')
      : 'Tidak diketahui',
    year: d.first_publish_year || null
  }));
}

// ---------- handler: books ----------
function daftarBuku(req, res, { url }) {
  let data = bacaData(FILE_BUKU);
  const kategori = url.searchParams.get('category');
  const penulis = url.searchParams.get('author');
  const kataKunci = url.searchParams.get('q');
  const status = url.searchParams.get('status');

  if (kategori) {
    data = data.filter((b) => b.category.toLowerCase() === kategori.trim().toLowerCase());
  }
  if (penulis) {
    data = data.filter((b) => b.author.toLowerCase().includes(penulis.trim().toLowerCase()));
  }
  if (kataKunci) {
    const k = kataKunci.trim().toLowerCase();
    data = data.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(k));
  }
  if (status) {
    data = data.filter((b) => b.status === status);
  }
  kirimJSON(res, 200, data);
}

async function cariBukuOpenLibrary(req, res, { url }) {
  const kataKunci = (url.searchParams.get('q') || '').trim();
  if (kataKunci === '') {
    return kirimError(res, 400, 'Parameter q wajib diisi');
  }
  const results = await cariDiOpenLibrary(kataKunci);
  kirimJSON(res, 200, { query: kataKunci, count: results.length, results });
}

function detailBuku(req, res, { id }) {
  const item = bacaData(FILE_BUKU).find((b) => b.id === id);
  if (!item) return kirimError(res, 404, `Buku dengan id ${id} tidak ditemukan`);
  kirimJSON(res, 200, item);
}

async function tambahBuku(req, res) {
  const input = await bacaBodyObjek(req);

  const kurang = [];
  let isbn = '';
  if (typeof input.isbn !== 'string') {
    kurang.push('isbn (wajib, berupa string)');
  } else {
    isbn = normalisasiIsbn(input.isbn);
    if (!isbnValid(isbn)) {
      kurang.push('isbn (10 atau 13 karakter angka; karakter terakhir ISBN-10 boleh X)');
    }
  }
  if (!teksValid(input.category)) kurang.push('category (wajib, tidak boleh kosong)');
  if (kurang.length > 0) {
    return kirimError(res, 400, `Validasi gagal, periksa field berikut: ${kurang.join('; ')}`);
  }

  const pesanDuplikat = `Buku dengan ISBN ${isbn} sudah terdaftar`;
  if (bacaData(FILE_BUKU).some((b) => b.isbn === isbn)) {
    return kirimError(res, 409, pesanDuplikat);
  }

  // Pemanggilan ke public API (bisa melempar 404 atau 502)
  const dariOpenLibrary = await ambilBukuDariOpenLibrary(isbn);

  // Data dibaca ulang karena selama menunggu Open Library ada request lain yang mungkin menulis data
  const buku = bacaData(FILE_BUKU);
  if (buku.some((b) => b.isbn === isbn)) {
    return kirimError(res, 409, pesanDuplikat);
  }
  const pinjaman = bacaData(FILE_PINJAMAN);
  const idBaru = idBerikutnya(buku.map((b) => b.id), pinjaman.map((p) => p.bookId));

  const item = {
    id: idBaru,
    isbn,
    title: dariOpenLibrary.title,
    author: dariOpenLibrary.author,
    year: dariOpenLibrary.year,
    category: input.category.trim(),
    status: 'available'
  };
  buku.push(item);
  simpanData(FILE_BUKU, buku);
  res.setHeader('Location', `/books/${idBaru}`);
  kirimJSON(res, 201, item);
}

async function ubahBuku(req, res, { id }) {
  const input = await bacaBodyObjek(req);
  const buku = bacaData(FILE_BUKU);
  const index = buku.findIndex((b) => b.id === id);
  if (index === -1) return kirimError(res, 404, `Buku dengan id ${id} tidak ditemukan`);

  const kurang = [];
  if (!teksValid(input.title)) kurang.push('title (wajib, tidak boleh kosong)');
  if (!teksValid(input.author)) kurang.push('author (wajib, tidak boleh kosong)');
  if (!teksValid(input.category)) kurang.push('category (wajib, tidak boleh kosong)');
  if (input.year === undefined || !tahunValid(input.year)) {
    kurang.push('year (bilangan bulat 0 sampai tahun berjalan, atau null)');
  }
  if (kurang.length > 0) {
    return kirimError(res, 400, `Validasi gagal, periksa field berikut: ${kurang.join('; ')}`);
  }

  // isbn, status, dan id tidak dapat diubah melalui PUT
  buku[index] = {
    ...buku[index],
    title: input.title.trim(),
    author: input.author.trim(),
    year: input.year,
    category: input.category.trim()
  };
  simpanData(FILE_BUKU, buku);
  kirimJSON(res, 200, buku[index]);
}

function hapusBuku(req, res, { id }) {
  const buku = bacaData(FILE_BUKU);
  const index = buku.findIndex((b) => b.id === id);
  if (index === -1) return kirimError(res, 404, `Buku dengan id ${id} tidak ditemukan`);
  if (buku[index].status === 'borrowed') {
    return kirimError(res, 409, 'Buku sedang dipinjam sehingga tidak dapat dihapus');
  }
  buku.splice(index, 1);
  simpanData(FILE_BUKU, buku);
  res.writeHead(204);
  res.end();
}

// ---------- handler: members ----------
function cekValidasiAnggota(input) {
  const kurang = [];
  if (!teksValid(input.name)) kurang.push('name (wajib, tidak boleh kosong)');
  if (!teksValid(input.stambuk)) kurang.push('stambuk (wajib, tidak boleh kosong)');
  return kurang;
}

function stambukSama(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function daftarAnggota(req, res) {
  kirimJSON(res, 200, bacaData(FILE_ANGGOTA));
}

function detailAnggota(req, res, { id }) {
  const item = bacaData(FILE_ANGGOTA).find((m) => m.id === id);
  if (!item) return kirimError(res, 404, `Anggota dengan id ${id} tidak ditemukan`);
  kirimJSON(res, 200, item);
}

async function tambahAnggota(req, res) {
  const input = await bacaBodyObjek(req);
  const kurang = cekValidasiAnggota(input);
  if (kurang.length > 0) {
    return kirimError(res, 400, `Validasi gagal, periksa field berikut: ${kurang.join('; ')}`);
  }

  const anggota = bacaData(FILE_ANGGOTA);
  if (anggota.some((m) => stambukSama(m.stambuk, input.stambuk))) {
    return kirimError(res, 409, `Stambuk ${input.stambuk.trim()} sudah terdaftar`);
  }
  const pinjaman = bacaData(FILE_PINJAMAN);
  const idBaru = idBerikutnya(anggota.map((m) => m.id), pinjaman.map((p) => p.memberId));

  const item = { id: idBaru, name: input.name.trim(), stambuk: input.stambuk.trim() };
  anggota.push(item);
  simpanData(FILE_ANGGOTA, anggota);
  res.setHeader('Location', `/members/${idBaru}`);
  kirimJSON(res, 201, item);
}

async function ubahAnggota(req, res, { id }) {
  const input = await bacaBodyObjek(req);
  const anggota = bacaData(FILE_ANGGOTA);
  const index = anggota.findIndex((m) => m.id === id);
  if (index === -1) return kirimError(res, 404, `Anggota dengan id ${id} tidak ditemukan`);

  const kurang = cekValidasiAnggota(input);
  if (kurang.length > 0) {
    return kirimError(res, 400, `Validasi gagal, periksa field berikut: ${kurang.join('; ')}`);
  }
  // stambuk tidak boleh sama dengan anggota lain (anggota itu sendiri boleh)
  if (anggota.some((m) => m.id !== id && stambukSama(m.stambuk, input.stambuk))) {
    return kirimError(res, 409, `Stambuk ${input.stambuk.trim()} sudah dipakai anggota lain`);
  }

  anggota[index] = { id, name: input.name.trim(), stambuk: input.stambuk.trim() };
  simpanData(FILE_ANGGOTA, anggota);
  kirimJSON(res, 200, anggota[index]);
}

function hapusAnggota(req, res, { id }) {
  const anggota = bacaData(FILE_ANGGOTA);
  const index = anggota.findIndex((m) => m.id === id);
  if (index === -1) return kirimError(res, 404, `Anggota dengan id ${id} tidak ditemukan`);

  const masihMeminjam = bacaData(FILE_PINJAMAN)
    .some((p) => p.memberId === id && p.status === 'active');
  if (masihMeminjam) {
    return kirimError(res, 409, 'Anggota masih memiliki pinjaman aktif sehingga tidak dapat dihapus');
  }
  anggota.splice(index, 1);
  simpanData(FILE_ANGGOTA, anggota);
  res.writeHead(204);
  res.end();
}

// ---------- handler: loans ----------
function terlambat(pinjaman) {
  return pinjaman.status === 'active' && new Date(pinjaman.dueDate) < new Date();
}

function daftarPinjaman(req, res, { url }) {
  let data = bacaData(FILE_PINJAMAN);
  const memberId = url.searchParams.get('memberId');
  const status = url.searchParams.get('status');
  const overdue = url.searchParams.get('overdue');

  if (memberId) data = data.filter((p) => String(p.memberId) === memberId.trim());
  if (status) data = data.filter((p) => p.status === status);
  if (overdue === 'true') data = data.filter(terlambat);
  kirimJSON(res, 200, data);
}

async function pinjamBuku(req, res) {
  const input = await bacaBodyObjek(req);
  const kurang = [];
  if (!idPositif(input.bookId)) kurang.push('bookId (wajib, bilangan bulat positif)');
  if (!idPositif(input.memberId)) kurang.push('memberId (wajib, bilangan bulat positif)');
  if (kurang.length > 0) {
    return kirimError(res, 400, `Validasi gagal, periksa field berikut: ${kurang.join('; ')}`);
  }

  const buku = bacaData(FILE_BUKU);
  const item = buku.find((b) => b.id === input.bookId);
  if (!item) return kirimError(res, 404, `Buku dengan id ${input.bookId} tidak ditemukan`);

  const anggota = bacaData(FILE_ANGGOTA).find((m) => m.id === input.memberId);
  if (!anggota) return kirimError(res, 404, `Anggota dengan id ${input.memberId} tidak ditemukan`);

  if (item.status !== 'available') {
    return kirimError(res, 409, 'Buku sedang dipinjam dan belum dikembalikan');
  }

  const pinjaman = bacaData(FILE_PINJAMAN);
  const sekarang = new Date();
  const batas = new Date(sekarang.getTime() + MASA_PINJAM_HARI * 24 * 60 * 60 * 1000);
  const baru = {
    id: idBerikutnya(pinjaman.map((p) => p.id)),
    bookId: item.id,
    memberId: anggota.id,
    loanDate: sekarang.toISOString(),
    dueDate: batas.toISOString(),
    returnDate: null,
    status: 'active'
  };
  pinjaman.push(baru);
  item.status = 'borrowed';
  simpanData(FILE_PINJAMAN, pinjaman);
  simpanData(FILE_BUKU, buku);
  kirimJSON(res, 201, baru);
}

function kembalikanBuku(req, res, { id }) {
  const pinjaman = bacaData(FILE_PINJAMAN);
  const item = pinjaman.find((p) => p.id === id);
  if (!item) return kirimError(res, 404, `Peminjaman dengan id ${id} tidak ditemukan`);
  if (item.status === 'returned') {
    return kirimError(res, 409, 'Peminjaman ini sudah dikembalikan sebelumnya');
  }

  item.status = 'returned';
  item.returnDate = new Date().toISOString();

  const buku = bacaData(FILE_BUKU);
  const bukuDipinjam = buku.find((b) => b.id === item.bookId);
  if (bukuDipinjam) bukuDipinjam.status = 'available';

  simpanData(FILE_PINJAMAN, pinjaman);
  simpanData(FILE_BUKU, buku);
  kirimJSON(res, 200, item);
}

// ---------- router ----------
// Tiap rute: pola path dan daftar method yang didukung beserta handler-nya.
// Grup tangkapan pertama pada pola (jika ada) adalah id pada URL.
// Rute /books/search harus lebih dulu daripada /books/{id}.
const RUTE = [
  { pola: /^\/books$/, metode: { GET: daftarBuku, POST: tambahBuku } },
  { pola: /^\/books\/search$/, metode: { GET: cariBukuOpenLibrary } },
  { pola: /^\/books\/([^/]+)$/, metode: { GET: detailBuku, PUT: ubahBuku, DELETE: hapusBuku } },
  { pola: /^\/members$/, metode: { GET: daftarAnggota, POST: tambahAnggota } },
  { pola: /^\/members\/([^/]+)$/, metode: { GET: detailAnggota, PUT: ubahAnggota, DELETE: hapusAnggota } },
  { pola: /^\/loans$/, metode: { GET: daftarPinjaman, POST: pinjamBuku } },
  { pola: /^\/loans\/([^/]+)$/, metode: { PUT: kembalikanBuku } }
];

async function router(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (err) {
    return kirimError(res, 400, 'URL tidak valid');
  }
  const jalur = url.pathname.replace(/\/+$/, '') || '/';

  for (const rute of RUTE) {
    const cocok = rute.pola.exec(jalur);
    if (!cocok) continue;

    const handler = rute.metode[req.method];
    if (!handler) {
      res.setHeader('Allow', Object.keys(rute.metode).join(', '));
      return kirimError(res, 405, `Method ${req.method} tidak didukung pada endpoint ini`);
    }
    const id = cocok[1] === undefined ? null : ambilId(cocok[1]);
    return handler(req, res, { url, id });
  }
  kirimError(res, 404, 'Endpoint tidak ditemukan');
}

// ---------- server ----------
siapkanPenyimpanan();

const server = http.createServer(async (req, res) => {
  res.on('finish', () => {
    console.log(`${new Date().toISOString()}  ${req.method} ${req.url}  ->  ${res.statusCode}`);
  });
  try {
    await router(req, res);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err.statusCode) return kirimError(res, err.statusCode, err.message);
    console.error(err);
    kirimError(res, 500, 'Terjadi kesalahan pada server');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah dipakai. Hentikan server yang lain (Ctrl+C) lalu coba lagi.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

module.exports = server;
