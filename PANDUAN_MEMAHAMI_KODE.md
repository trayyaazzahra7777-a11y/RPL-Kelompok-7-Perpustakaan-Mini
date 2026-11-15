# Panduan Memahami Kode (untuk persiapan demo dan tanya jawab)

Aturan tugas: setiap anggota harus bisa menjelaskan bagian kode atas namanya dan menelusuri/mengubahnya saat demo.
Pelajari bagian milikmu dengan cara: baca fungsinya, jalankan, lalu ubah sesuatu kecil dan lihat hasilnya.

## Alur umum satu request (semua anggota harus hafal)
1. `http.createServer` menerima request, mencatat log, memanggil `router`.
2. `router` mencocokkan path dengan tabel `RUTE`. Jika path cocok tapi method tidak ada: 405 + header `Allow`. Jika path tidak cocok: 404.
3. Untuk path berisi id, `ambilId` memastikan id bilangan bulat positif (jika tidak: 400).
4. Handler membaca data (`bacaData`), memeriksa aturan, mengubah data, menyimpan (`simpanData`), membalas lewat `kirimJSON`/`kirimError`.
5. Jika ada error dengan `statusCode` (dibuat `buatError`), blok `catch` di server mengubahnya menjadi respons. Error tak terduga menjadi 500.

## Trayya: kerangka, books, Open Library
- `idBerikutnya`: kenapa id loans ikut dihitung? (agar id buku yang sudah dihapus tidak dipakai lagi).
- `panggilOpenLibrary`: apa yang terjadi jika internet mati / lebih dari 8 detik? (502). Jika ISBN tidak ada? (404, dari `ambilBukuDariOpenLibrary`).
- `ambilTahun`: dari "September 1, 1996" menjadi 1996; jika tidak ada, `null`.
- `tambahBuku`: urutan 400 -> 409 -> Open Library (404/502) -> baca ulang -> simpan -> 201 + Location. Kenapa data dibaca ulang setelah menunggu Open Library?
- Latihan demo: ubah batas waktu jadi 1 ms lalu coba POST /books; ganti `MASA_PINJAM_HARI`.

## Rahmita: members
- Validasi `name` dan `stambuk`, pengecekan stambuk ganda (`stambukSama`), 409.
- `ubahAnggota`: kenapa pengecekan duplikat memakai `m.id !== id`? (agar anggota boleh menyimpan stambuknya sendiri).
- `hapusAnggota`: kenapa 409 jika masih ada pinjaman aktif?
- Latihan demo: tambah field baru (misalnya `email`) pada validasi dan penyimpanan.

## Syifa: loans
- `pinjamBuku`: urutan pemeriksaan 400 -> buku 404 -> anggota 404 -> status buku 409; `dueDate` = `loanDate` + 7 hari; status buku menjadi `borrowed`.
- `kembalikanBuku`: 409 jika sudah dikembalikan; status buku kembali `available`.
- `terlambat` dan filter `overdue=true`: aktif dan `dueDate` sudah lewat.
- Latihan demo: ubah masa pinjam jadi 3 hari; ubah `dueDate` di `data/loans.json` lalu panggil `?overdue=true`.

## Safitri: client.js, Postman, laporan
- `panggil`: satu fungsi untuk semua request (fetch). Jika server mati, `fetch` melempar error -> `gagalJaringan`.
- `tampilkan`: status >= 400 dicetak sebagai [GAGAL ...] tanpa stack trace.
- `tanyaDenganDefault`: Enter = pertahankan nilai lama (menu ubah).
- Kenapa client tidak membaca file JSON langsung? (syarat tugas: client memanggil API lewat HTTP).
- Latihan demo: tambah menu baru yang memanggil `GET /books?status=available`.

## Pertanyaan yang mungkin diajukan
- Kenapa 409 bukan 400 untuk ISBN ganda? Kenapa 502 untuk Open Library mati? Kenapa 204 tanpa isi?
- Apa beda `PUT` dan `PATCH`? Kenapa `PATCH /books` membalas 405?
- Bagaimana data tetap ada setelah server dimatikan? (file JSON lewat `fs`).
- Kenapa `fs` sinkron dipakai di sini? (supaya baca-ubah-tulis tidak disela request lain; cukup untuk skala tugas ini).
