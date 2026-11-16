const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Tentukan direktori fixture pengujian dan direktori data asli
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const ORIGINAL_DATA_DIR = path.resolve(__dirname, '..', 'data');

const FIXTURE_BOOKS = path.join(FIXTURES_DIR, 'books.json');
const FIXTURE_MEMBERS = path.join(FIXTURES_DIR, 'members.json');
const FIXTURE_LOANS = path.join(FIXTURES_DIR, 'loans.json');

// Pastikan DATA_DIR mengarah ke tests/fixtures SEBELUM server.js di-require
process.env.DATA_DIR = FIXTURES_DIR;

// Snapshot data asli di folder data/ untuk menjamin data asli tidak berubah
function ambilSnapshotDataAsli() {
  const files = ['books.json', 'members.json', 'loans.json'];
  const snapshot = {};
  for (const f of files) {
    const fullPath = path.join(ORIGINAL_DATA_DIR, f);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      snapshot[f] = { content: content.toString('utf8'), hash };
    }
  }
  return snapshot;
}

const snapshotAwalDataAsli = ambilSnapshotDataAsli();

// Dataset awal untuk fixture pengujian
const SEED_BOOKS = [
  {
    id: 1,
    isbn: '9780140328721',
    title: 'Fantastic Mr. Fox',
    author: 'Roald Dahl',
    year: 1988,
    category: 'Fiksi',
    status: 'available'
  },
  {
    id: 2,
    isbn: '9780132350884',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    year: 2008,
    category: 'Teknologi',
    status: 'borrowed'
  }
];

const SEED_MEMBERS = [
  { id: 1, name: 'Andi Pratama', stambuk: 'F5512520901' },
  { id: 2, name: 'Bunga Lestari', stambuk: 'F5512520902' }
];

const SEED_LOANS = [
  {
    id: 1,
    bookId: 2,
    memberId: 1,
    loanDate: '2026-10-01T10:00:00.000Z',
    dueDate: '2026-10-08T10:00:00.000Z',
    returnDate: null,
    status: 'active'
  }
];

function resetFixtures() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(FIXTURE_BOOKS, JSON.stringify(SEED_BOOKS, null, 2), 'utf8');
  fs.writeFileSync(FIXTURE_MEMBERS, JSON.stringify(SEED_MEMBERS, null, 2), 'utf8');
  fs.writeFileSync(FIXTURE_LOANS, JSON.stringify(SEED_LOANS, null, 2), 'utf8');
}

// Inisialisasi fixture pertama kali
resetFixtures();

// Server Mock untuk Open Library agar pengujian tidak bergantung jaringan luar
let mockOpenLibraryServer;
let mockOpenLibraryUrl;

function startMockOpenLibrary() {
  return new Promise((resolve, reject) => {
    mockOpenLibraryServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');

      if (parsedUrl.pathname === '/api/books') {
        const bibkeys = parsedUrl.searchParams.get('bibkeys') || '';
        if (bibkeys.includes('ISBN:9780345391803')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              'ISBN:9780345391803': {
                title: "The Hitchhiker's Guide to the Galaxy",
                authors: [{ name: 'Douglas Adams' }],
                publish_date: '1979'
              }
            })
          );
        } else if (bibkeys.includes('ISBN:9780140328721')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              'ISBN:9780140328721': {
                title: 'Fantastic Mr. Fox',
                authors: [{ name: 'Roald Dahl' }],
                publish_date: '1988'
              }
            })
          );
        } else {
          // ISBN tidak ditemukan
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({}));
        }
      }

      if (parsedUrl.pathname === '/search.json') {
        const query = parsedUrl.searchParams.get('q') || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            docs: [
              {
                key: '/works/OL123W',
                title: `Hasil pencarian untuk: ${query}`,
                author_name: ['Penulis Uji'],
                first_publish_year: 2021
              }
            ]
          })
        );
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    mockOpenLibraryServer.listen(0, '127.0.0.1', () => {
      const port = mockOpenLibraryServer.address().port;
      mockOpenLibraryUrl = `http://127.0.0.1:${port}`;
      process.env.OPENLIBRARY_URL = mockOpenLibraryUrl;
      resolve();
    });
    mockOpenLibraryServer.on('error', reject);
  });
}

// Helper HTTP Client untuk mempermudah request dalam test
let baseUrl = '';

async function api(method, endpoint, body = null, headers = {}) {
  const reqHeaders = { ...headers };
  let payload = null;

  if (body !== null) {
    if (typeof body === 'object') {
      reqHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    } else {
      payload = String(body);
    }
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: payload
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  return {
    status: res.status,
    headers: res.headers,
    body: json,
    rawText: text
  };
}

// Mulai test suite
test.describe('Automated Test Suite - Perpustakaan Mini API', async () => {
  let appServer;

  test.before(async () => {
    // 1. Jalankan mock Open Library
    await startMockOpenLibrary();

    // 2. Muat server aplikasi setelah environment variabel siap
    appServer = require('../server.js');

    // 3. Jalankan server aplikasi pada port acak (0)
    await new Promise((resolve, reject) => {
      appServer.listen(0, '127.0.0.1', () => {
        const port = appServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
      appServer.on('error', reject);
    });
  });

  test.beforeEach(() => {
    // Kembalikan data fixture ke kondisi awal sebelum setiap unit pengujian
    resetFixtures();
  });

  test.after(async () => {
    // Tutup server aplikasi dan server mock
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => mockOpenLibraryServer.close(resolve));

    // Bersihkan fixture kembali ke format array kosong agar git status tetap bersih
    fs.writeFileSync(FIXTURE_BOOKS, '[]\n', 'utf8');
    fs.writeFileSync(FIXTURE_MEMBERS, '[]\n', 'utf8');
    fs.writeFileSync(FIXTURE_LOANS, '[]\n', 'utf8');

    // Verifikasi final bahwa data asli di data/ tidak pernah disentuh
    const snapshotAkhir = ambilSnapshotDataAsli();
    for (const [namaFile, dataAwal] of Object.entries(snapshotAwalDataAsli)) {
      assert.ok(snapshotAkhir[namaFile], `File ${namaFile} harus tetap ada di data/`);
      assert.equal(
        snapshotAkhir[namaFile].hash,
        dataAwal.hash,
        `File data/${namaFile} telah berubah! Integritas data asli terlanggar.`
      );
    }
  });

  // ---------- Pengujian Routing & Error Handling Global ----------
  test.describe('Routing dan Error Handling', () => {
    test('Mengembalikan 404 jika mengakses endpoint yang tidak terdaftar', async () => {
      const res = await api('GET', '/endpoint-tidak-ada');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Endpoint tidak ditemukan');
    });

    test('Mengembalikan 405 dengan header Allow jika method tidak didukung', async () => {
      const res = await api('PATCH', '/books');
      assert.equal(res.status, 405);
      assert.ok(res.headers.get('allow').includes('GET'));
      assert.ok(res.headers.get('allow').includes('POST'));
      assert.ok(res.body.error.includes('Method PATCH tidak didukung'));
    });

    test('Mengembalikan 400 jika body request bukan JSON yang valid', async () => {
      const res = await api('POST', '/members', 'ini bukan json {', {
        'Content-Type': 'application/json'
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Body request bukan JSON yang valid');
    });
  });

  // ---------- Pengujian Endpoint /books ----------
  test.describe('Endpoint Buku (/books)', () => {
    test('GET /books mengembalikan daftar semua buku dengan status 200', async () => {
      const res = await api('GET', '/books');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 2);
      assert.equal(res.body[0].title, 'Fantastic Mr. Fox');
    });

    test('GET /books dengan filter category, status, dan author', async () => {
      const resKategori = await api('GET', '/books?category=Teknologi');
      assert.equal(resKategori.status, 200);
      assert.equal(resKategori.body.length, 1);
      assert.equal(resKategori.body[0].isbn, '9780132350884');

      const resStatus = await api('GET', '/books?status=available');
      assert.equal(resStatus.status, 200);
      assert.equal(resStatus.body.length, 1);
      assert.equal(resStatus.body[0].id, 1);

      const resPenulis = await api('GET', '/books?author=Martin');
      assert.equal(resPenulis.status, 200);
      assert.equal(resPenulis.body.length, 1);
      assert.equal(resPenulis.body[0].author, 'Robert C. Martin');
    });

    test('GET /books?q= pencarian kata kunci judul atau penulis', async () => {
      const res = await api('GET', '/books?q=Fox');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].id, 1);
    });

    test('GET /books/:id mengembalikan detail buku atau 404 jika tidak ditemukan', async () => {
      const resAda = await api('GET', '/books/1');
      assert.equal(resAda.status, 200);
      assert.equal(resAda.body.id, 1);
      assert.equal(resAda.body.title, 'Fantastic Mr. Fox');

      const resTidakAda = await api('GET', '/books/999');
      assert.equal(resTidakAda.status, 404);
      assert.ok(resTidakAda.body.error.includes('tidak ditemukan'));

      const resIdSalah = await api('GET', '/books/abc');
      assert.equal(resIdSalah.status, 400);
      assert.equal(resIdSalah.body.error, 'id harus berupa bilangan bulat positif');
    });

    test('POST /books berhasil menambahkan buku baru dari Open Library', async () => {
      const input = {
        isbn: '9780345391803',
        category: 'Fiksi Ilmiah'
      };
      const res = await api('POST', '/books', input);
      assert.equal(res.status, 201);
      assert.equal(res.body.isbn, '9780345391803');
      assert.equal(res.body.title, "The Hitchhiker's Guide to the Galaxy");
      assert.equal(res.body.author, 'Douglas Adams');
      assert.equal(res.body.year, 1979);
      assert.equal(res.body.category, 'Fiksi Ilmiah');
      assert.equal(res.body.status, 'available');
      assert.ok(res.headers.get('location'));
    });

    test('POST /books mengembalikan 400 jika field wajib tidak valid', async () => {
      const res = await api('POST', '/books', { isbn: '123' });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('Validasi gagal'));
    });

    test('POST /books mengembalikan 409 jika ISBN sudah terdaftar', async () => {
      const input = {
        isbn: '9780140328721', // sudah ada di SEED_BOOKS
        category: 'Fiksi'
      };
      const res = await api('POST', '/books', input);
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('sudah terdaftar'));
    });

    test('POST /books mengembalikan 404 jika ISBN tidak ditemukan di Open Library', async () => {
      const input = {
        isbn: '9780000000000',
        category: 'Fiksi'
      };
      const res = await api('POST', '/books', input);
      assert.equal(res.status, 404);
      assert.ok(res.body.error.includes('tidak ditemukan di Open Library'));
    });

    test('PUT /books/:id berhasil memperbarui buku yang ada', async () => {
      const updateData = {
        title: 'Fantastic Mr. Fox - Edisi Revisi',
        author: 'Roald Dahl',
        year: 1990,
        category: 'Fiksi Anak'
      };
      const res = await api('PUT', '/books/1', updateData);
      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Fantastic Mr. Fox - Edisi Revisi');
      assert.equal(res.body.category, 'Fiksi Anak');
      assert.equal(res.body.year, 1990);
    });

    test('PUT /books/:id mengembalikan 400 jika data tidak lengkap atau tahun tidak valid', async () => {
      const res = await api('PUT', '/books/1', { title: 'Hanya Judul' });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('Validasi gagal'));

      const resTahunSalah = await api('PUT', '/books/1', {
        title: 'Judul',
        author: 'Penulis',
        year: 3000,
        category: 'Umum'
      });
      assert.equal(resTahunSalah.status, 400);
    });

    test('DELETE /books/:id berhasil menghapus buku yang statusnya available', async () => {
      const res = await api('DELETE', '/books/1');
      assert.equal(res.status, 204);

      // Verifikasi buku sudah terhapus
      const cek = await api('GET', '/books/1');
      assert.equal(cek.status, 404);
    });

    test('DELETE /books/:id mengembalikan 409 jika buku sedang dipinjam', async () => {
      // Buku id 2 berstatus 'borrowed' di SEED_BOOKS
      const res = await api('DELETE', '/books/2');
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('sedang dipinjam'));
    });
  });

  // ---------- Pengujian Endpoint /members ----------
  test.describe('Endpoint Anggota (/members)', () => {
    test('GET /members mengembalikan daftar anggota', async () => {
      const res = await api('GET', '/members');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 2);
      assert.equal(res.body[0].name, 'Andi Pratama');
    });

    test('GET /members/:id mengembalikan detail anggota atau 404', async () => {
      const resAda = await api('GET', '/members/1');
      assert.equal(resAda.status, 200);
      assert.equal(resAda.body.name, 'Andi Pratama');

      const resTidakAda = await api('GET', '/members/999');
      assert.equal(resTidakAda.status, 404);
    });

    test('POST /members berhasil mendaftarkan anggota baru', async () => {
      const input = { name: 'Citra Dewi', stambuk: 'F5512520903' };
      const res = await api('POST', '/members', input);
      assert.equal(res.status, 201);
      assert.equal(res.body.name, 'Citra Dewi');
      assert.equal(res.body.stambuk, 'F5512520903');
      assert.ok(res.headers.get('location'));
    });

    test('POST /members mengembalikan 400 jika field kosong atau tidak lengkap', async () => {
      const res = await api('POST', '/members', { name: '   ', stambuk: '' });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('Validasi gagal'));
    });

    test('POST /members mengembalikan 409 jika stambuk sudah terdaftar', async () => {
      const input = { name: 'Andi KW', stambuk: 'f5512520901' }; // perbandingan case-insensitive
      const res = await api('POST', '/members', input);
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('sudah terdaftar'));
    });

    test('PUT /members/:id berhasil mengubah nama anggota dengan stambuk yang sama', async () => {
      const input = { name: 'Andi Pratama S.T.', stambuk: 'F5512520901' };
      const res = await api('PUT', '/members/1', input);
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Andi Pratama S.T.');
    });

    test('PUT /members/:id mengembalikan 409 jika stambuk bertabrakan dengan anggota lain', async () => {
      const input = { name: 'Andi Pratama', stambuk: 'F5512520902' }; // milik id 2
      const res = await api('PUT', '/members/1', input);
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('sudah dipakai'));
    });

    test('DELETE /members/:id mengembalikan 409 jika anggota memiliki pinjaman aktif', async () => {
      // Member 1 memiliki pinjaman aktif di SEED_LOANS
      const res = await api('DELETE', '/members/1');
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('masih memiliki pinjaman aktif'));
    });

    test('DELETE /members/:id berhasil menghapus anggota tanpa pinjaman aktif', async () => {
      const res = await api('DELETE', '/members/2');
      assert.equal(res.status, 204);

      const cek = await api('GET', '/members/2');
      assert.equal(cek.status, 404);
    });
  });

  // ---------- Pengujian Endpoint /loans ----------
  test.describe('Endpoint Peminjaman (/loans)', () => {
    test('GET /loans mengembalikan daftar peminjaman', async () => {
      const res = await api('GET', '/loans');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].status, 'active');
    });

    test('GET /loans dengan filter status, memberId, dan overdue', async () => {
      const resStatus = await api('GET', '/loans?status=active');
      assert.equal(resStatus.status, 200);
      assert.equal(resStatus.body.length, 1);

      const resMember = await api('GET', '/loans?memberId=1');
      assert.equal(resMember.status, 200);
      assert.equal(resMember.body.length, 1);

      const resOverdue = await api('GET', '/loans?overdue=true');
      assert.equal(resOverdue.status, 200);
      assert.equal(resOverdue.body.length, 1); // SEED_LOANS dueDate adalah 2026-10-08 (lampau)
    });

    test('POST /loans berhasil meminjam buku yang available', async () => {
      const input = { bookId: 1, memberId: 2 };
      const res = await api('POST', '/loans', input);
      assert.equal(res.status, 201);
      assert.equal(res.body.bookId, 1);
      assert.equal(res.body.memberId, 2);
      assert.equal(res.body.status, 'active');
      assert.ok(res.body.dueDate);

      // Verifikasi status buku berubah menjadi borrowed
      const cekBuku = await api('GET', '/books/1');
      assert.equal(cekBuku.body.status, 'borrowed');
    });

    test('POST /loans mengembalikan 404 jika buku atau anggota tidak ada', async () => {
      const resBuku = await api('POST', '/loans', { bookId: 999, memberId: 1 });
      assert.equal(resBuku.status, 404);
      assert.ok(resBuku.body.error.includes('Buku dengan id 999 tidak ditemukan'));

      const resAnggota = await api('POST', '/loans', { bookId: 1, memberId: 999 });
      assert.equal(resAnggota.status, 404);
      assert.ok(resAnggota.body.error.includes('Anggota dengan id 999 tidak ditemukan'));
    });

    test('POST /loans mengembalikan 409 jika buku sedang dipinjam', async () => {
      // Buku 2 sedang dipinjam
      const res = await api('POST', '/loans', { bookId: 2, memberId: 2 });
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes('sedang dipinjam'));
    });

    test('PUT /loans/:id berhasil mengembalikan buku', async () => {
      const res = await api('PUT', '/loans/1');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'returned');
      assert.ok(res.body.returnDate);

      // Verifikasi status buku kembali menjadi available
      const cekBuku = await api('GET', '/books/2');
      assert.equal(cekBuku.body.status, 'available');
    });

    test('PUT /loans/:id mengembalikan 409 jika peminjaman sudah pernah dikembalikan', async () => {
      // Kembalikan sekali
      await api('PUT', '/loans/1');
      // Kembalikan kedua kali
      const resUlang = await api('PUT', '/loans/1');
      assert.equal(resUlang.status, 409);
      assert.ok(resUlang.body.error.includes('sudah dikembalikan'));
    });

    test('PUT /loans/:id mengembalikan 404 jika ID peminjaman tidak ada', async () => {
      const res = await api('PUT', '/loans/999');
      assert.equal(res.status, 404);
    });
  });

  // ---------- Pengujian Endpoint /books/search (Integrasi Open Library) ----------
  test.describe('Endpoint Pencarian Open Library (/books/search)', () => {
    test('GET /books/search?q= berhasil mengembalikan hasil pencarian', async () => {
      const res = await api('GET', '/books/search?q=clean');
      assert.equal(res.status, 200);
      assert.equal(res.body.query, 'clean');
      assert.ok(Array.isArray(res.body.results));
      assert.equal(res.body.results.length, 1);
    });

    test('GET /books/search tanpa q mengembalikan 400', async () => {
      const res = await api('GET', '/books/search');
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Parameter q wajib diisi');
    });
  });

  // ---------- Pengujian Isolasi Data ----------
  test.describe('Verifikasi Isolasi Data (data/ vs tests/fixtures/)', () => {
    test('Semua file di data/ tidak mengalami modifikasi sedikit pun', () => {
      const snapshot = ambilSnapshotDataAsli();
      for (const [namaFile, dataAwal] of Object.entries(snapshotAwalDataAsli)) {
        assert.equal(
          snapshot[namaFile].hash,
          dataAwal.hash,
          `File data/${namaFile} telah termodifikasi oleh pengujian!`
        );
      }
    });

    test('Operasi penyimpanan bekerja di tests/fixtures/', () => {
      assert.ok(fs.existsSync(FIXTURE_BOOKS));
      assert.ok(fs.existsSync(FIXTURE_MEMBERS));
      assert.ok(fs.existsSync(FIXTURE_LOANS));
    });
  });
});
