<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

const fields = [
  { key: 'gmv', label: 'GMV', prefix: 'Rp', step: '1' },
  { key: 'sku', label: 'SKU', step: '1' },
  { key: 'views', label: 'Views', step: '1' },
  { key: 'comments', label: 'Komentar', step: '1' },
]
const emptySession = () => ({ gmv: '', sku: '', views: '', comments: '' })
const sessions = reactive(Array.from({ length: 4 }, emptySession))
const currentSession = ref(0)
const page = ref('entry')
const history = ref([])
const saving = ref(false)
const dbError = ref('')
const activeResult = ref(null)
const installPrompt = ref(null)
const copiedReport = ref(false)
const reportToDelete = ref(null)

const completed = computed(() => sessions.map((session) => fields.every((field) => session[field.key] !== '' && Number.isFinite(Number(session[field.key])))))
const canContinue = computed(() => true)
const allComplete = computed(() => completed.value.every(Boolean))

function resultFor(sessionList) {
  return fields.map((field) => {
    const first = Number(sessionList[1][field.key]) - Number(sessionList[0][field.key])
    const second = Number(sessionList[3][field.key]) - Number(sessionList[2][field.key])
    return { ...field, first, second, total: first + second }
  })
}
const currentResults = computed(() => allComplete.value ? resultFor(sessions) : [])

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value)
}
function inputDisplayValue(value) {
  if (value === '') return ''
  const digits = String(value).replace(/\D/g, '')
  return digits ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(digits)) : ''
}
function updateInputValue(event, fieldKey) {
  const digits = event.target.value.replace(/\D/g, '')
  sessions[currentSession.value][fieldKey] = digits
  event.target.value = inputDisplayValue(digits)
}
function formatCurrency(value) {
  return `Rp ${formatNumber(value)}`
}
function formatted(field, value) {
  return field.key === 'gmv' ? formatCurrency(value) : formatNumber(value)
}
function rawReportText(report) {
  return report.results.map((result) => `${result.label}: ${formatNumber(result.total)}`).join('\n')
}
async function copyRawReport(report) {
  try {
    await navigator.clipboard.writeText(rawReportText(report))
    copiedReport.value = true
    dbError.value = ''
  } catch {
    copiedReport.value = false
    dbError.value = 'Tidak dapat menyalin otomatis. Pilih dan salin teks laporan secara manual.'
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Browser ini tidak mendukung IndexedDB.'))
    const request = indexedDB.open('gmv-counter', 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('reports')) database.createObjectStore('reports', { keyPath: 'id', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Database tidak dapat dibuka.'))
  })
}

async function loadHistory() {
  try {
    const db = await openDatabase()
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('reports', 'readonly').objectStore('reports').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    history.value = rows.sort((a, b) => b.createdAt - a.createdAt)
    db.close()
  } catch (error) {
    dbError.value = error.message || 'Riwayat belum dapat dimuat.'
  }
}

async function saveReport() {
  if (!allComplete.value || saving.value) return
  saving.value = true
  dbError.value = ''
  const report = {
    createdAt: Date.now(),
    sessions: sessions.map((session) => Object.fromEntries(fields.map(({ key }) => [key, Number(session[key])]))),
    results: resultFor(sessions),
  }
  try {
    const db = await openDatabase()
    const id = await new Promise((resolve, reject) => {
      const transaction = db.transaction('reports', 'readwrite')
      const request = transaction.objectStore('reports').add(report)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    report.id = id
    activeResult.value = report
    await loadHistory()
    page.value = 'report'
  } catch (error) {
    dbError.value = `${error.message || 'Gagal menyimpan laporan.'} Coba lagi.`
  } finally {
    saving.value = false
  }
}

async function deleteReport() {
  const id = reportToDelete.value?.id
  if (id == null) return
  try {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('reports', 'readwrite')
      transaction.objectStore('reports').delete(id)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('Penghapusan dibatalkan.'))
    })
    db.close()
    history.value = history.value.filter((item) => item.id !== id)
    if (activeResult.value?.id === id) activeResult.value = null
    reportToDelete.value = null
  } catch (error) {
    dbError.value = error.message || 'Riwayat gagal dihapus.'
  }
}

function startNew() {
  sessions.forEach((session) => Object.assign(session, emptySession()))
  activeResult.value = null
  copiedReport.value = false
  currentSession.value = 0
  page.value = 'entry'
  dbError.value = ''
}
function selectHistory(report) {
  activeResult.value = report
  copiedReport.value = false
  page.value = 'report'
  dbError.value = ''
}
function goNext() {
  if (currentSession.value < 3) {
    fillEmptyValues(currentSession.value)
    currentSession.value += 1
  }
}
function fillEmptyValues(index) {
  for (const { key } of fields) {
    if (sessions[index][key] === '') sessions[index][key] = '0'
  }
}
function goBack() {
  if (currentSession.value > 0) currentSession.value -= 1
}
function dateLabel(timestamp) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}
async function installApp() {
  if (!installPrompt.value) return
  await installPrompt.value.prompt()
  installPrompt.value = null
}

onMounted(() => {
  loadHistory()
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt.value = event
  })
  window.addEventListener('appinstalled', () => { installPrompt.value = null })
})
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <button class="flex items-center gap-3 text-left" @click="startNew" aria-label="GMV Counter, mulai input baru">
          <span><span class="block text-sm font-bold tracking-tight">GMV Counter</span><span class="block text-xs text-slate-500">Akumulasi performa sesi</span></span>
        </button>
        <div class="flex items-center gap-2">
          <button v-if="installPrompt" class="rounded-lg bg-pink-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-pink-700" @click="installApp">Install aplikasi</button>
          <button class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900" @click="page = 'history'">Riwayat <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{{ history.length }}</span></button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <section v-if="page === 'entry'" class="mx-auto max-w-3xl">
        <header class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-pink-700 via-pink-600 to-fuchsia-600 px-6 py-7 text-white shadow-lg shadow-pink-200/60 sm:px-8 sm:py-9">
          <div class="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p class="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-pink-200">Input data</p>
              <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Catat performa sesi</h1>
            </div>
          </div>
        </header>

        <div class="mb-8 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
          <div class="mb-7 flex items-start justify-between gap-2">
            <div v-for="(session, index) in sessions" :key="index" class="flex min-w-0 flex-1 flex-col items-center">
              <button class="mb-2 grid size-9 place-items-center rounded-full border text-sm font-bold transition" :class="index === currentSession ? 'border-pink-600 bg-pink-600 text-white shadow-md shadow-pink-200' : completed[index] ? 'border-pink-200 bg-pink-50 text-pink-700' : 'border-slate-200 bg-white text-slate-400'" :aria-label="`Pilih Sesi ${index + 1}`" @click="completed[index] && (currentSession = index)">{{ completed[index] ? '✓' : index + 1 }}</button>
            </div>
          </div>
          <div class="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{{ currentSession + 1 }} / 4</span>
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <label v-for="field in fields" :key="field.key" class="block">
              <span class="mb-2 block text-sm font-semibold text-slate-700">{{ field.label }}</span>
              <span class="relative block">
                <span v-if="field.prefix" class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">{{ field.prefix }}</span>
                <input :value="inputDisplayValue(sessions[currentSession][field.key])" type="text" inputmode="numeric" autocomplete="off" :placeholder="field.key === 'gmv' ? '0' : 'Masukkan jumlah'" class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition placeholder:text-slate-300 focus:border-pink-500 focus:ring-4 focus:ring-pink-100" :class="field.prefix ? 'pl-12' : ''" :aria-label="field.label" @input="updateInputValue($event, field.key)" />
              </span>
            </label>
          </div>
          <div class="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <button class="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" :disabled="currentSession === 0" @click="goBack">← <span class="ml-1">Kembali</span></button>
            <button v-if="currentSession < 3" class="rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canContinue" @click="goNext">Lanjutkan <span class="ml-1">→</span></button>
            <button v-else class="rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="saving" @click="fillEmptyValues(currentSession); saveReport()">{{ saving ? 'Menyimpan…' : 'Hitung & simpan laporan' }} <span v-if="!saving" class="ml-1">→</span></button>
          </div>
        </div>
        <div class="rounded-xl border border-pink-100 bg-pink-50/70 px-4 py-3 text-sm leading-6 text-pink-900"><span class="mr-2 font-bold">Rumus</span><span class="text-pink-800">(Sesi 2 − Sesi 1) + (Sesi 4 − Sesi 3)</span></div>
      </section>

      <section v-else-if="page === 'report' && activeResult" class="mx-auto max-w-4xl">
        <header class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-pink-700 via-pink-600 to-fuchsia-600 px-6 py-7 text-white shadow-lg shadow-pink-200/60 sm:px-8 sm:py-9">
          <div class="flex flex-wrap items-end justify-between gap-5">
            <div>
              <button class="mb-5 inline-flex items-center gap-2 text-sm font-medium text-pink-100 transition hover:text-white" @click="page = 'history'">← Kembali ke riwayat</button>
              <p class="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-pink-200">Laporan hasil</p>
              <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Akumulasi GMV</h1>
              <p class="mt-2 text-sm text-pink-100">{{ dateLabel(activeResult.createdAt) }}</p>
            </div>
            <button class="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-pink-700 shadow-sm transition hover:bg-pink-50" @click="startNew">+ Input baru</button>
          </div>
        </header>
        <div class="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div class="grid grid-cols-[1.2fr_1fr_1fr_1.1fr] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:gap-4 sm:px-6"><span>Metrik</span><span>Sesi 2 − 1</span><span>Sesi 4 − 3</span><span>Total akumulasi</span></div>
          <div v-for="result in activeResult.results" :key="result.key" class="grid grid-cols-[1.2fr_1fr_1fr_1.1fr] items-center gap-2 border-b border-slate-100 px-4 py-4 last:border-0 sm:gap-4 sm:px-6"><span class="text-sm font-semibold">{{ result.label }}</span><span class="text-xs text-slate-600 sm:text-sm">{{ formatted(result, result.first) }}</span><span class="text-xs text-slate-600 sm:text-sm">{{ formatted(result, result.second) }}</span><span class="text-sm font-bold text-pink-700 sm:text-base">{{ formatted(result, result.total) }}</span></div>
        </div>
        <section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="font-bold">Ringkasan teks</h2><p class="mt-1 text-sm text-slate-500">Format siap disalin dan dibagikan.</p></div>
            <button class="rounded-lg border px-3 py-2 text-sm font-semibold transition" :class="copiedReport ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'" :aria-label="copiedReport ? 'Teks berhasil disalin' : 'Salin teks laporan'" @click="copyRawReport(activeResult)">{{ copiedReport ? '✓ Berhasil disalin' : 'Salin teks' }}</button>
          </div>
          <pre class="overflow-x-auto rounded-xl bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-800">{{ rawReportText(activeResult) }}</pre>
        </section>
        <details class="group rounded-2xl border border-slate-200 bg-white"><summary class="cursor-pointer list-none px-5 py-4 font-semibold marker:hidden">Lihat input setiap sesi <span class="float-right text-slate-400 transition group-open:rotate-180">⌄</span></summary><div class="overflow-x-auto border-t border-slate-100"><table class="w-full min-w-[500px] text-left text-sm"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-5 py-3">Metrik</th><th v-for="(_, index) in activeResult.sessions" :key="index" class="px-4 py-3">Sesi {{ index + 1 }}</th></tr></thead><tbody><tr v-for="field in fields" :key="field.key" class="border-t border-slate-100"><td class="px-5 py-3 font-medium">{{ field.label }}</td><td v-for="(session, index) in activeResult.sessions" :key="index" class="px-4 py-3">{{ formatted(field, session[field.key]) }}</td></tr></tbody></table></div></details>
      </section>

      <section v-else class="mx-auto max-w-4xl">
        <header class="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-pink-700 via-pink-600 to-fuchsia-600 px-6 py-7 text-white shadow-lg shadow-pink-200/60 sm:px-8 sm:py-9">
          <div class="flex flex-wrap items-end justify-between gap-5">
            <div>
              <button class="mb-5 inline-flex items-center gap-2 text-sm font-medium text-pink-100 transition hover:text-white" @click="page = 'entry'">← Kembali ke input</button>
              <p class="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-pink-200">Arsip lokal</p>
              <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Riwayat laporan</h1>
            </div>
            <div class="flex items-center gap-3">
              <span class="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold">{{ history.length }} {{ history.length === 1 ? 'laporan' : 'laporan' }}</span>
              <button class="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-pink-700 shadow-sm transition hover:bg-pink-50" @click="startNew">+ Input baru</button>
            </div>
          </div>
        </header>
        <div v-if="history.length" class="space-y-3"><article v-for="report in history" :key="report.id" class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-pink-200"><button class="min-w-0 flex-1 text-left" @click="selectHistory(report)"><span class="block font-bold">{{ formatCurrency(report.results.find((item) => item.key === 'gmv')?.total ?? 0) }} <span class="font-medium text-slate-500">GMV</span></span><span class="mt-1 block text-sm text-slate-500">{{ dateLabel(report.createdAt) }}</span></button><button class="rounded-lg px-3 py-2 text-sm font-semibold text-pink-700 hover:bg-pink-50" @click="selectHistory(report)">Lihat laporan →</button><button class="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600" :aria-label="`Hapus laporan ${dateLabel(report.createdAt)}`" @click="reportToDelete = report">Hapus</button></article></div>
        <div v-else class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><span class="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-500">↗</span><h2 class="font-bold">Belum ada laporan</h2><p class="mt-2 text-sm text-slate-500">Selesaikan input empat sesi untuk menyimpan hasil pertamamu.</p><button class="mt-5 font-semibold text-pink-700 hover:text-pink-900" @click="startNew">Mulai input →</button></div>
      </section>
      <p v-if="dbError" role="alert" class="mx-auto mt-5 max-w-3xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ dbError }}</p>
    </main>
    <div v-if="reportToDelete" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5" @click.self="reportToDelete = null">
      <section role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div class="mb-4 grid size-11 place-items-center rounded-full bg-rose-50 text-lg text-rose-600">!</div>
        <h2 id="delete-dialog-title" class="text-lg font-bold">Hapus laporan ini?</h2>
        <p class="mt-2 text-sm leading-6 text-slate-500">Laporan tanggal {{ dateLabel(reportToDelete.createdAt) }} akan dihapus dari riwayat perangkat ini.</p>
        <div class="mt-6 flex justify-end gap-3">
          <button class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="reportToDelete = null">Batal</button>
          <button class="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700" @click="deleteReport">Hapus laporan</button>
        </div>
      </section>
    </div>
    <footer class="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-400">Dibuat oleh <a href="https://crkstudio.com" target="_blank" rel="noopener noreferrer" class="font-semibold text-slate-500 transition hover:text-pink-600">CRK Studio</a></footer>
  </div>
</template>
