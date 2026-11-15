const readline = require('readline/promises');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', () => process.exit(0));

const NAMA_STATUS = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  500: 'Internal Server Error', 502: 'Bad Gateway'
};

// ---------- pemanggilan API kelompok melalui HTTP ----------
async function panggil(method, jalur, body) {
  const opsi = {
    method,
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  };
  if (body !== undefined) {
    opsi.headers['Content-Type'] = 'application/json';
    opsi.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_URL + jalur, opsi);
  } catch (err) {
    return { gagalJaringan: true };
  }
  const teks = await res.text();
  let data = null;
  if (teks !== '') {
    try { data = JSON.parse(teks); } catch (err) { data = teks; }
  }
  return { status: res.status, data };
}

// Menampilkan hasil. Kegagalan ditampilkan sebagai pesan singkat, tanpa stack trace.
// Mengembalikan true jika permintaan berhasil.
function tampilkan(hasil, cetakData) {
  if (hasil.gagalJaringan) {
    console.log(`\n[GAGAL] Tidak dapat terhubung ke server di ${API_URL}.`);
    console.log('        Pastikan server sudah berjalan (node server.js).');
    return false;
  }
  const nama = NAMA_STATUS[hasil.status] || '';
  if (hasil.status >= 400) {
    const pesan = hasil.data && hasil.data.error ? hasil.data.error : 'Permintaan ditolak server';
    console.log(`\n[GAGAL ${hasil.status} ${nama}] ${pesan}`);
    return false;
  }
  console.log(`\n[BERHASIL ${hasil.status} ${nama}]`);
  if (cetakData) cetakData(hasil.data);
  return true;
}

// ---------- tampilan data ----------
const tanggal = (iso) => (iso ? iso.slice(0, 10) : '-');

function cetakObjek(obj) {
  for (const [kunci, nilai] of Object.entries(obj)) {
    console.log(`  ${kunci.padEnd(11)}: ${nilai === null ? '-' : nilai}`);
  }
}

function cetakTabel(daftar, ubah) {
  if (daftar.length === 0) {
    console.log('  (tidak ada data)');
    return;
  }
  console.table(ubah ? daftar.map(ubah) : daftar);
  console.log(`  Jumlah: ${daftar.length}`);
}

function cetakPinjaman(p) {
  return {
    id: p.id,
    bookId: p.bookId,
    memberId: p.memberId,
    loanDate: tanggal(p.loanDate),
    dueDate: tanggal(p.dueDate),
    returnDate: tanggal(p.returnDate),
    status: p.status,
    terlambat: p.status === 'active' && new Date(p.dueDate) < new Date() ? 'YA' : '-'
  };
}

// ---------- input ----------
async function tanya(pertanyaan) {
  return (await rl.question(pertanyaan)).trim();
}

// Jika dikosongkan, memakai nilai lama (untuk menu ubah).
async function tanyaDenganDefault(label, nilaiLama) {
  const jawab = await tanya(`${label} [${nilaiLama === null ? '-' : nilaiLama}]: `);
  return jawab === '' ? nilaiLama : jawab;
}

// id dikirim apa adanya agar validasi dilakukan oleh server.
async function tanyaId(label) {
  return encodeURIComponent(await tanya(`${label}: `));
}

// Angka dikirim sebagai number; jika bukan angka dikirim apa adanya agar server menolaknya (400).
function keAngka(teks) {
  const angka = Number(teks);
  return teks === '' || Number.isNaN(angka) ? teks : angka;
}

// ---------- menu: books ----------
async function menuDaftarBuku() {
  console.log('Filter (kosongkan jika tidak dipakai):');
  const params = new URLSearchParams();
  for (const [nama, label] of [
    ['category', 'category'], ['author', 'author'], ['q', 'kata kunci judul/penulis (q)'],
    ['status', 'status (available/borrowed)']
  ]) {
    const nilai = await tanya(`  ${label}: `);
    if (nilai !== '') params.set(nama, nilai);
  }
  const query = params.toString();
  tampilkan(await panggil('GET', '/books' + (query ? `?${query}` : '')), (data) => {
    cetakTabel(data, (b) => ({
      id: b.id, isbn: b.isbn, title: b.title, author: b.author,
      year: b.year, category: b.category, status: b.status
    }));
  });
}

async function menuCariOpenLibrary() {
  const q = await tanya('Kata kunci pencarian di Open Library: ');
  tampilkan(await panggil('GET', `/books/search?q=${encodeURIComponent(q)}`), (data) => {
    console.log(`  Kata kunci: ${data.query}`);
    cetakTabel(data.results, (r) => ({
      title: r.title, author: r.author, year: r.year, key: r.key
    }));
  });
}

async function menuDetailBuku() {
  const id = await tanyaId('id buku');
  tampilkan(await panggil('GET', `/books/${id}`), cetakObjek);
}

async function menuTambahBuku() {
  const isbn = await tanya('ISBN (10 atau 13 digit): ');
  const category = await tanya('category: ');
  console.log('Menghubungi Open Library, mohon tunggu...');
  tampilkan(await panggil('POST', '/books', { isbn, category }), cetakObjek);
}

async function menuUbahBuku() {
  const id = await tanyaId('id buku yang diubah');
  const sekarang = await panggil('GET', `/books/${id}`);
  if (!tampilkan(sekarang)) return;
  console.log('Tekan Enter untuk mempertahankan nilai lama.');
  const b = sekarang.data;
  const title = await tanyaDenganDefault('title', b.title);
  const author = await tanyaDenganDefault('author', b.author);
  const year = await tanyaDenganDefault('year (ketik null untuk mengosongkan)', b.year);
  const category = await tanyaDenganDefault('category', b.category);
  const tahun = year === 'null' || year === null ? null : keAngka(String(year));
  tampilkan(await panggil('PUT', `/books/${id}`, { title, author, year: tahun, category }), cetakObjek);
}

async function menuHapusBuku() {
  const id = await tanyaId('id buku yang dihapus');
  tampilkan(await panggil('DELETE', `/books/${id}`), () => console.log('  Buku berhasil dihapus.'));
}

// ---------- menu: members ----------
async function menuDaftarAnggota() {
  tampilkan(await panggil('GET', '/members'), (data) => cetakTabel(data));
}

async function menuDetailAnggota() {
  const id = await tanyaId('id anggota');
  tampilkan(await panggil('GET', `/members/${id}`), cetakObjek);
}

async function menuTambahAnggota() {
  const name = await tanya('name: ');
  const stambuk = await tanya('stambuk: ');
  tampilkan(await panggil('POST', '/members', { name, stambuk }), cetakObjek);
}

async function menuUbahAnggota() {
  const id = await tanyaId('id anggota yang diubah');
  const sekarang = await panggil('GET', `/members/${id}`);
  if (!tampilkan(sekarang)) return;
  console.log('Tekan Enter untuk mempertahankan nilai lama.');
  const name = await tanyaDenganDefault('name', sekarang.data.name);
  const stambuk = await tanyaDenganDefault('stambuk', sekarang.data.stambuk);
  tampilkan(await panggil('PUT', `/members/${id}`, { name, stambuk }), cetakObjek);
}

async function menuHapusAnggota() {
  const id = await tanyaId('id anggota yang dihapus');
  tampilkan(await panggil('DELETE', `/members/${id}`), () => console.log('  Anggota berhasil dihapus.'));
}

// ---------- menu: loans ----------
async function menuDaftarPinjaman() {
  console.log('Filter (kosongkan jika tidak dipakai):');
  const params = new URLSearchParams();
  const memberId = await tanya('  memberId: ');
  const status = await tanya('  status (active/returned): ');
  const overdue = await tanya('  hanya yang terlambat? (y/n): ');
  if (memberId !== '') params.set('memberId', memberId);
  if (status !== '') params.set('status', status);
  if (overdue.toLowerCase() === 'y') params.set('overdue', 'true');
  const query = params.toString();
  tampilkan(await panggil('GET', '/loans' + (query ? `?${query}` : '')), (data) => {
    cetakTabel(data, cetakPinjaman);
  });
}

async function menuPinjamBuku() {
  const bookId = keAngka(await tanya('bookId: '));
  const memberId = keAngka(await tanya('memberId: '));
  tampilkan(await panggil('POST', '/loans', { bookId, memberId }), (data) => {
    cetakObjek(data);
    console.log(`  Batas pengembalian: ${tanggal(data.dueDate)}`);
  });
}

async function menuKembalikanBuku() {
  const id = await tanyaId('id peminjaman yang dikembalikan');
  tampilkan(await panggil('PUT', `/loans/${id}`), cetakObjek);
}

// ---------- menu utama ----------
const MENU = [
  { judul: 'BUKU', garis: true },
  { no: '1', teks: 'Lihat daftar buku (dengan filter)', aksi: menuDaftarBuku },
  { no: '2', teks: 'Cari buku di Open Library', aksi: menuCariOpenLibrary },
  { no: '3', teks: 'Detail buku', aksi: menuDetailBuku },
  { no: '4', teks: 'Tambah buku melalui ISBN', aksi: menuTambahBuku },
  { no: '5', teks: 'Ubah buku', aksi: menuUbahBuku },
  { no: '6', teks: 'Hapus buku', aksi: menuHapusBuku },
  { judul: 'ANGGOTA', garis: true },
  { no: '7', teks: 'Lihat daftar anggota', aksi: menuDaftarAnggota },
  { no: '8', teks: 'Detail anggota', aksi: menuDetailAnggota },
  { no: '9', teks: 'Tambah anggota', aksi: menuTambahAnggota },
  { no: '10', teks: 'Ubah anggota', aksi: menuUbahAnggota },
  { no: '11', teks: 'Hapus anggota', aksi: menuHapusAnggota },
  { judul: 'PEMINJAMAN', garis: true },
  { no: '12', teks: 'Lihat daftar peminjaman (dengan filter)', aksi: menuDaftarPinjaman },
  { no: '13', teks: 'Pinjam buku', aksi: menuPinjamBuku },
  { no: '14', teks: 'Kembalikan buku', aksi: menuKembalikanBuku }
];

function cetakMenu() {
  console.log('\n========== PERPUSTAKAAN MINI - KELOMPOK 7 ==========');
  for (const m of MENU) {
    if (m.judul) console.log(`-- ${m.judul}`);
    else console.log(`  ${m.no.padStart(2)}. ${m.teks}`);
  }
  console.log('  0. Keluar');
}

async function main() {
  console.log(`Client console terhubung ke API: ${API_URL}`);
  while (true) {
    cetakMenu();
    const pilihan = await tanya('Pilih menu: ');
    if (pilihan === '0') break;
    const menu = MENU.find((m) => m.no === pilihan);
    if (!menu) {
      console.log('\n[GAGAL] Pilihan tidak dikenal. Masukkan angka 0 sampai 14.');
      continue;
    }
    try {
      await menu.aksi();
    } catch (err) {
      console.log('\n[GAGAL] Terjadi kesalahan pada client. Silakan coba lagi.');
    }
  }
  console.log('Sampai jumpa.');
  rl.close();
}

main();
