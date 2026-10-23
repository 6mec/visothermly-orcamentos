import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, runTransaction, query, orderBy, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const fbApp = initializeApp(window.VT_FIREBASE);
const auth = getAuth(fbApp);
let db;
try { db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(fbApp, {}); }
const storage = getStorage(fbApp);

// ---------- utilitários ----------
function $(id) { return document.getElementById(id); }
var eurF = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
function eur(v) { return eurF.format(v || 0).replace(/ /g, ' '); }
function num(v) {
  if (v == null) return null;
  var s = String(v).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  var n = parseFloat(s);
  return isFinite(n) && n >= 0 ? n : null;
}
function fmtN(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
function hoje() { return new Date().toISOString().slice(0, 10); }
function dataPT(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function addDias(iso, d) { var t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
var toastT;
function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3000); }
function falhou(e, oque) { console.error(e); toast('Não foi possível ' + oque + '. ' + (e && e.code === 'permission-denied' ? 'Sem permissão.' : 'Verifique a internet.')); }

// ---------- estado ----------
var user = null, perfil = {}, config = {}, clientes = [], orcs = [], membros = [];
var settings = {};
var cur = null, dirty = false, clienteAberto = null;
var subs = [], subsCli = [];
var pagamentos = [], fotos = [];
var K_DRAFT = 'vt-rascunho-v2';
var ESTADOS = ['Por enviar', 'Enviado', 'Aceite', 'Recusado', 'Concluído'];
var Q_FIELDS = ['c_nome', 'c_tel', 'c_nif', 'o_morada', 'modo', 'o_area', 'o_iso', 'o_esp', 'o_desc', 'mo_tipo', 'mo_preco', 'mo_rend', 'mo_dias', 'm_mat', 'm_and', 'm_margem', 'd_tipo', 'd_km', 'd_viagens', 'd_cons', 'd_comb', 'd_port', 'd_valor', 'iva', 'validade', 'condicoes', 'notas'];
var CFG_FIELDS = ['s_nome', 's_nif', 's_tel', 's_email', 's_morada', 's_isencao', 's_rend', 's_cons', 's_validade', 's_iva', 's_desc', 's_cond'];

function recalcSettings() {
  settings = Object.assign({ s_nome: 'VisoThermLy' }, config);
  if (!settings.s_nome) settings.s_nome = 'VisoThermLy';
  settings.s_resp = perfil.nome || '';
  settings.s_tel = perfil.telefone || config.s_tel || '';
}

// ---------- navegação ----------
function show(v) {
  ['clientes', 'cliente', 'novo', 'def'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
  var navV = v === 'cliente' ? 'clientes' : v;
  document.querySelectorAll('nav button').forEach(function (b) { if (b.dataset.v === navV) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.v); }); });

// ---------- orçamento ----------
function blankQuote(clienteId) {
  var f = {};
  Q_FIELDS.forEach(function (k) { f[k] = ''; });
  f.modo = 'mo'; f.mo_tipo = 'm2'; f.d_tipo = 'calc'; f.o_iso = '';
  f.o_desc = settings.s_desc || 'Aplicação de sistema de isolamento térmico pelo exterior (capoto / ETICS) na fachada.';
  f.mo_rend = settings.s_rend || '';
  f.d_cons = settings.s_cons || '';
  f.iva = settings.s_iva || '0';
  f.validade = settings.s_validade || '';
  f.condicoes = settings.s_cond || '';
  var c = clienteId && clientes.find(function (x) { return x.id === clienteId; });
  if (c) { f.c_nome = c.nome || ''; f.c_tel = c.telefone || ''; f.c_nif = c.nif || ''; f.o_morada = c.morada || ''; }
  return { id: null, num: null, data: null, estado: 'Por enviar', f: f, extras: [], clienteId: c ? c.id : null };
}
function renderClienteSelect() {
  var sel = $('c_sel'), v = cur && cur.clienteId || '';
  sel.innerHTML = '<option value="">Novo cliente</option>' + clientes.map(function (c) { return '<option value="' + c.id + '">' + esc(c.nome || 'Sem nome') + '</option>'; }).join('');
  sel.value = v;
}
function toForm(q) {
  Q_FIELDS.forEach(function (k) { $(k).value = q.f[k] == null ? '' : q.f[k]; });
  renderClienteSelect();
  renderExtras();
  $('q-num').textContent = q.num ? 'Orçamento n.º ' + q.num : 'Novo orçamento';
  $('q-info').textContent = q.num ? (q.estado + ' · criado a ' + dataPT(q.data)) : 'Ainda não guardado';
  calc();
}
function fromForm() { Q_FIELDS.forEach(function (k) { cur.f[k] = $(k).value; }); }
$('c_sel').addEventListener('change', function () {
  var id = $('c_sel').value;
  cur.clienteId = id || null;
  var c = id && clientes.find(function (x) { return x.id === id; });
  if (c) { $('c_nome').value = c.nome || ''; $('c_tel').value = c.telefone || ''; $('c_nif').value = c.nif || ''; $('o_morada').value = c.morada || ''; }
  changed();
});

  function renderExtras() {
    var box = $('extras');
    box.innerHTML = cur.extras.map(function (x, i) {
      return '<div class="extra"><label for="ex_d' + i + '">Descrição<input id="ex_d' + i + '" data-i="' + i + '" data-k="d" type="text" value="' + esc(x.d) + '"></label>' +
        '<label for="ex_v' + i + '">Valor (€)<input id="ex_v' + i + '" data-i="' + i + '" data-k="v" type="text" inputmode="decimal" value="' + esc(x.v) + '"></label>' +
        '<button type="button" class="btn danger" data-del="' + i + '" aria-label="Remover trabalho extra">✕</button></div>';
    }).join('');
  }
  $('extras').addEventListener('input', function (e) {
    var i = e.target.dataset.i; if (i == null) return;
    cur.extras[i][e.target.dataset.k] = e.target.value; changed();
  });
  $('extras').addEventListener('click', function (e) {
    var i = e.target.dataset.del; if (i == null) return;
    cur.extras.splice(+i, 1); renderExtras(); changed();
  });
  $('b-extra').addEventListener('click', function () {
    cur.extras.push({ d: '', v: '' }); renderExtras(); changed();
    var last = $('ex_d' + (cur.extras.length - 1)); if (last) last.focus();
  });

  function compute(q) {
    var f = q.f, falta = [], lines = [], info = [];
    var area = num(f.o_area), preco = num(f.mo_preco), rend = num(f.mo_rend), diasM = num(f.mo_dias);
    var dias = diasM != null ? Math.ceil(diasM) : (area && rend ? Math.ceil(area / rend) : null);
    var completa = f.modo === 'completa';

    // mão de obra
    var mo = 0;
    if (preco == null) falta.push(f.mo_tipo === 'global' ? 'Valor total da mão de obra' : 'Preço da mão de obra');
    if (f.mo_tipo === 'm2') {
      if (area == null) falta.push('Área de fachada');
      if (area != null && preco != null) { mo = area * preco; lines.push(['Mão de obra: ' + fmtN(area) + ' m² × ' + eur(preco), mo]); }
    } else if (f.mo_tipo === 'dia') {
      if (dias == null) falta.push('Dias de trabalho (ou área e rendimento)');
      if (dias != null && preco != null) { mo = dias * preco; lines.push(['Mão de obra: ' + dias + (dias === 1 ? ' dia' : ' dias') + ' × ' + eur(preco), mo]); }
    } else if (preco != null) { mo = preco; lines.push(['Mão de obra', mo]); }

    // material e andaime (margem incluída no preço ao cliente)
    var mat = 0, and = 0, margemV = 0;
    if (completa) {
      var pm = num(f.m_mat), pa = num(f.m_and), mg = (num(f.m_margem) || 0) / 100;
      if (area == null && f.mo_tipo !== 'm2') falta.push('Área de fachada');
      if (pm == null) falta.push('Preço do material por m²');
      if (area != null && pm != null) { mat = area * pm * (1 + mg); margemV += area * pm * mg; lines.push(['Material: ' + fmtN(area) + ' m² × ' + eur(pm * (1 + mg)), mat]); }
      if (area != null && pa != null && pa > 0) { and = area * pa * (1 + mg); margemV += area * pa * mg; lines.push(['Andaime: ' + fmtN(area) + ' m² × ' + eur(pa * (1 + mg)), and]); }
    }

    // deslocações
    var desl = 0;
    if (f.d_tipo === 'calc') {
      var km = num(f.d_km), cons = num(f.d_cons), comb = num(f.d_comb), port = num(f.d_port) || 0, vM = num(f.d_viagens);
      var viagens = vM != null ? Math.ceil(vM) : dias;
      if (km == null) falta.push('Km da deslocação');
      if (cons == null) falta.push('Consumo da carrinha');
      if (comb == null) falta.push('Preço do combustível');
      if (viagens == null) falta.push('Número de viagens (ou dias de trabalho)');
      if (km != null && cons != null && comb != null && viagens) {
        var porViagem = km * cons / 100 * comb + port;
        desl = viagens * porViagem;
        lines.push(['Deslocações: ' + viagens + (viagens === 1 ? ' viagem' : ' viagens') + ' de ' + fmtN(km) + ' km', desl]);
        info.push(['Custo por viagem', eur(porViagem)]);
      }
    } else if (f.d_tipo === 'manual') {
      var dv = num(f.d_valor);
      if (dv == null) falta.push('Valor das deslocações');
      else if (dv > 0) { desl = dv; lines.push(['Deslocações', desl]); }
    }

    // extras
    var ext = 0;
    q.extras.forEach(function (x) {
      var v = num(x.v);
      if (v != null && v > 0) { ext += v; lines.push([(x.d || 'Trabalho extra').trim(), v]); }
      else if ((x.d || '').trim()) falta.push('Valor de "' + x.d.trim() + '"');
    });

    var base = mo + mat + and + desl + ext;
    var taxa = num(f.iva) || 0;
    var ivaV = base * taxa / 100;
    if (dias != null) info.unshift(['Dias de trabalho', String(dias)]);
    if (area && base) info.unshift(['Preço por m² (sem IVA)', eur(base / area)]);
    if (margemV) info.push(['Margem incluída no material', eur(margemV)]);
    return { lines: lines, base: base, taxa: taxa, ivaV: ivaV, total: base + ivaV, dias: dias, area: area, falta: falta, info: info };
  }

  function calc() {
    var f = cur.f;
    var completa = f.modo === 'completa';
    $('sec-mat').hidden = !completa;
    $('l_mo').textContent = f.mo_tipo === 'm2' ? 'Preço por m² (€)' : f.mo_tipo === 'dia' ? 'Preço por dia de equipa (€)' : 'Valor total da mão de obra (€)';
    $('d_calc').hidden = $('h_viagens').hidden = f.d_tipo !== 'calc';
    $('d_man').hidden = f.d_tipo !== 'manual';
    var r = compute(cur);
    var est = num(f.o_area) && num(f.mo_rend) ? Math.ceil(num(f.o_area) / num(f.mo_rend)) : null;
    $('mo_dias').placeholder = est ? 'Estimativa: ' + est : '';
    $('d_viagens').placeholder = r.dias ? 'Igual aos dias: ' + r.dias : '';

    var h = r.lines.map(function (l) { return '<tr><td>' + esc(l[0]) + '</td><td>' + eur(l[1]) + '</td></tr>'; }).join('');
    if (r.lines.length) {
      h += '<tr class="sum"><td>Total sem IVA</td><td>' + eur(r.base) + '</td></tr>';
      h += r.taxa ? '<tr><td>IVA (' + r.taxa + ' %)</td><td>' + eur(r.ivaV) + '</td></tr>' : '<tr><td>IVA</td><td>Isento</td></tr>';
    }
    $('linhas').innerHTML = h;
    $('t-lbl').textContent = r.taxa ? 'Total com IVA' : 'Total';
    $('t-val').textContent = eur(r.total);
    $('facts').innerHTML = r.info.map(function (x) { return '<span>' + esc(x[0]) + ': <strong>' + esc(x[1]) + '</strong></span>'; }).join('');
    var fb = $('falta');
    fb.hidden = !r.falta.length;
    fb.innerHTML = r.falta.length ? 'Falta preencher:<ul>' + r.falta.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '';
    return r;
  }

function changed() { dirty = true; fromForm(); calc(); lsSet(K_DRAFT, { q: cur, dirty: dirty }); }
Q_FIELDS.forEach(function (k) { $(k).addEventListener('input', changed); $(k).addEventListener('change', changed); });

async function proximoNumero() {
  var ano = new Date().getFullYear();
  if (navigator.onLine) {
    try {
      var n = await runTransaction(db, async function (tx) {
        var ref = doc(db, 'config', 'geral');
        var s = await tx.get(ref);
        var v = (s.exists() && s.data().proximoNumero) || 1;
        tx.set(ref, { proximoNumero: v + 1 }, { merge: true });
        return v;
      });
      return ano + '/' + String(n).padStart(3, '0');
    } catch (e) { console.warn(e); }
  }
  return ano + '/T' + String(Date.now()).slice(-5);
}

async function guardar() {
  fromForm();
  var f = cur.f, r = compute(cur);
  if (!(f.c_nome || '').trim()) { toast('Escreva o nome do cliente.'); $('c_nome').focus(); return false; }
  var btn = $('b-guardar'); btn.disabled = true;
  try {
    if (!cur.clienteId) {
      var cref = doc(collection(db, 'clientes'));
      setDoc(cref, { nome: f.c_nome.trim(), telefone: f.c_tel || '', nif: f.c_nif || '', morada: f.o_morada || '', email: '', notas: '', criadoEm: serverTimestamp(), criadoPor: perfil.nome || user.email }).catch(function (e) { falhou(e, 'criar o cliente'); });
      cur.clienteId = cref.id;
    }
    if (!cur.id) {
      cur.num = await proximoNumero();
      cur.data = hoje();
      cur.id = doc(collection(db, 'orcamentos')).id;
    }
    setDoc(doc(db, 'orcamentos', cur.id), {
      num: cur.num, data: cur.data, estado: cur.estado || 'Por enviar', f: cur.f, extras: cur.extras,
      clienteId: cur.clienteId, cliente: f.c_nome.trim(), morada: f.o_morada || '', total: r.total,
      atualizadoEm: serverTimestamp(), atualizadoPor: perfil.nome || user.email
    }).catch(function (e) { falhou(e, 'guardar o orçamento'); });
    dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur);
    toast('Orçamento ' + cur.num + ' guardado' + (navigator.onLine ? '.' : '. Será enviado para a equipa quando houver internet.'));
    return true;
  } finally { btn.disabled = false; }
}
$('b-guardar').addEventListener('click', function () { guardar(); });
$('b-novo').addEventListener('click', function () {
  if (dirty && !confirm('Este orçamento tem alterações por guardar. Começar um novo na mesma?')) return;
  cur = blankQuote(); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); window.scrollTo(0, 0);
});

  function resumoTexto() {
    var r = compute(cur), f = cur.f;
    var t = (settings.s_nome || 'Orçamento') + (cur.num ? ' – Orçamento n.º ' + cur.num : ' – Orçamento') + '\n';
    if (f.c_nome) t += 'Cliente: ' + f.c_nome + '\n';
    if (f.o_morada) t += 'Obra: ' + f.o_morada + '\n';
    if (f.o_desc) t += '\n' + f.o_desc + '\n';
    var det = [];
    if (r.area) det.push(fmtN(r.area) + ' m² de fachada');
    if (f.o_iso) det.push(f.o_iso + (num(f.o_esp) ? ' ' + fmtN(num(f.o_esp)) + ' cm' : ''));
    if (f.modo === 'mo') det.push('só mão de obra (material e andaime por conta do cliente)');
    if (det.length) t += det.join(', ') + '\n';
    t += '\n';
    r.lines.forEach(function (l) { t += l[0] + ': ' + eur(l[1]) + '\n'; });
    t += '\nTotal sem IVA: ' + eur(r.base) + '\n';
    t += r.taxa ? 'IVA (' + r.taxa + ' %): ' + eur(r.ivaV) + '\nTotal com IVA: ' + eur(r.total) + '\n' : 'IVA: isento\n';
    if (r.dias) t += 'Duração prevista: ' + r.dias + (r.dias === 1 ? ' dia' : ' dias') + ' de trabalho\n';
    if (f.condicoes) t += '\nPagamento: ' + f.condicoes + '\n';
    var contacto = [settings.s_resp, settings.s_tel].filter(Boolean).join(' · ');
    if (contacto) t += '\n' + contacto;
    return t.trim();
  }
  $('b-texto').addEventListener('click', function () {
    fromForm();
    var t = resumoTexto();
    if (navigator.share) { navigator.share({ text: t }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('Resumo copiado. Cole-o na mensagem.'); }, function () { toast('Não foi possível copiar.'); });
  });


  // ---------- PDF ----------
  function safe(s) { return String(s == null ? '' : s).replace(/ /g, ' ').replace(/\t/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF€–—‘’“”•…×]/g, ''); }

  async function gerarPDF() {
    fromForm();
    var r = compute(cur);
    if (!r.lines.length) { toast('Preencha o orçamento antes de gerar o PDF.'); return; }
    if (!cur.id) { if (!(await guardar())) return; }
    var L = window.PDFLib, f = cur.f, S = settings;
    var doc = await L.PDFDocument.create();
    var reg = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var W = 595.28, H = 841.89, M = 48, CW = W - 2 * M;
    var dark = L.rgb(0.169, 0.204, 0.251), blue = L.rgb(0.129, 0.357, 0.529), navy = L.rgb(0.090, 0.247, 0.373), orange = navy, gold = L.rgb(0.882, 0.580, 0.259), grey = L.rgb(0.35, 0.38, 0.42), lineC = L.rgb(0.83, 0.85, 0.87);
    var page = doc.addPage([W, H]), y;
    doc.setTitle('Orçamento ' + cur.num); doc.setAuthor(S.s_nome || '');

    function text(s, x, yy, size, font, color) { page.drawText(safe(s), { x: x, y: yy, size: size, font: font || reg, color: color || dark }); }
    function width(s, size, font) { return (font || reg).widthOfTextAtSize(safe(s), size); }
    function wrap(s, size, font, maxW) {
      var out = [];
      safe(s).split('\n').forEach(function (par) {
        var words = par.split(' '), lineS = '';
        words.forEach(function (w) {
          var test = lineS ? lineS + ' ' + w : w;
          if (width(test, size, font) > maxW && lineS) { out.push(lineS); lineS = w; } else lineS = test;
        });
        out.push(lineS);
      });
      return out;
    }
    function need(h) { if (y - h < 70) { page = doc.addPage([W, H]); y = H - M; } }
    function para(s, size, font, color, maxW, lead) {
      wrap(s, size, font, maxW || CW).forEach(function (l) { need(lead || size * 1.4); text(l, M, y, size, font, color); y -= (lead || size * 1.4); });
    }

    // cabeçalho
    page.drawRectangle({ x: 0, y: H - 100, width: W, height: 100, color: blue });
    page.drawRectangle({ x: 0, y: H - 104, width: W, height: 4, color: gold });
    var tx = M;
    try { var png = await doc.embedPng(await (await fetch('logo-icone.png')).arrayBuffer()); page.drawRectangle({ x: M, y: H - 84, width: 64, height: 64, color: L.rgb(1, 1, 1) }); page.drawImage(png, { x: M + 4, y: H - 80, width: 56, height: 56 }); tx = M + 78; } catch (e) {}
    text(S.s_nome || 'Orçamento', tx, H - 52, 22, bold, L.rgb(1, 1, 1));
    text('Capoto & isolamento térmico', tx, H - 72, 10, reg, L.rgb(0.85, 0.87, 0.9));
    var rt = 'ORÇAMENTO N.º ' + cur.num;
    text(rt, W - M - width(rt, 12, bold), H - 48, 12, bold, L.rgb(1, 1, 1));
    var dt = 'Data: ' + dataPT(cur.data);
    text(dt, W - M - width(dt, 10), H - 64, 10, reg, L.rgb(0.85, 0.87, 0.9));
    var val = num(f.validade);
    if (val) { var vt = 'Válido até: ' + dataPT(addDias(cur.data, val)); text(vt, W - M - width(vt, 10), H - 78, 10, reg, L.rgb(0.85, 0.87, 0.9)); }
    y = H - 135;

    // cliente e empresa
    var colW = CW / 2 - 10, y0 = y;
    function bloco(titulo, linhas, x) {
      var yy = y0;
      text(titulo, x, yy, 9, bold, grey); yy -= 15;
      linhas.filter(Boolean).forEach(function (l, i) {
        wrap(l, 10, i === 0 ? bold : reg, colW).forEach(function (w) { text(w, x, yy, 10, i === 0 ? bold : reg); yy -= 14; });
      });
      return yy;
    }
    var y1 = bloco('CLIENTE', [f.c_nome || '—', f.c_tel && 'Tel.: ' + f.c_tel, f.c_nif && 'NIF: ' + f.c_nif, f.o_morada && 'Obra: ' + f.o_morada], M);
    var y2 = bloco('DE', [S.s_nome, S.s_resp, S.s_tel && 'Tel.: ' + S.s_tel, S.s_email, S.s_nif && 'NIF: ' + S.s_nif, S.s_morada], M + CW / 2 + 10);
    y = Math.min(y1, y2) - 14;

    // trabalhos
    text('TRABALHOS', M, y, 9, bold, grey); y -= 16;
    if (f.o_desc) para(f.o_desc, 10.5, reg, dark);
    var det = [];
    if (r.area) det.push('Área: ' + fmtN(r.area) + ' m²');
    if (f.o_iso) det.push('Isolamento: ' + f.o_iso + (num(f.o_esp) ? ' ' + fmtN(num(f.o_esp)) + ' cm' : ''));
    if (r.dias) det.push('Duração prevista: ' + r.dias + (r.dias === 1 ? ' dia' : ' dias') + ' de trabalho');
    if (det.length) para(det.join('   ·   '), 9.5, reg, grey);
    if (f.modo === 'mo') para('Orçamento de mão de obra. Material e andaime fornecidos pelo cliente.', 9.5, reg, grey);
    y -= 8;

    // tabela
    need(40);
    page.drawRectangle({ x: M, y: y - 6, width: CW, height: 22, color: L.rgb(0.918, 0.941, 0.969) });
    text('Descrição', M + 8, y + 1, 9.5, bold); text('Valor', W - M - 8 - width('Valor', 9.5, bold), y + 1, 9.5, bold);
    y -= 24;
    r.lines.forEach(function (l) {
      var ls = wrap(l[0], 10, reg, CW - 120);
      need(ls.length * 14 + 10);
      var v = eur(l[1]);
      text(v, W - M - 8 - width(v, 10), y, 10);
      ls.forEach(function (w) { text(w, M + 8, y, 10); y -= 14; });
      y -= 4;
      page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: lineC });
      y -= 6;
    });
    function tot(lbl, v, b, size, color) {
      need(20);
      text(lbl, W - M - 230, y, size || 10, b ? bold : reg, color);
      text(v, W - M - 8 - width(v, size || 10, b ? bold : reg), y, size || 10, b ? bold : reg, color);
      y -= (size || 10) + 8;
    }
    y -= 4;
    tot('Total sem IVA', eur(r.base), true);
    if (r.taxa) tot('IVA (' + r.taxa + ' %)', eur(r.ivaV));
    else tot('IVA', 'Isento');
    y -= 2;
    need(34);
    page.drawRectangle({ x: W - M - 240, y: y - 10, width: 240, height: 30, color: L.rgb(0.984, 0.933, 0.867) });
    text('TOTAL', W - M - 230, y, 12, bold, navy);
    var tv = eur(r.total); text(tv, W - M - 8 - width(tv, 14, bold), y, 14, bold, orange);
    y -= 34;
    if (!r.taxa && S.s_isencao) { para(S.s_isencao, 9, reg, grey); }
    y -= 8;

    if (f.condicoes) { need(30); text('CONDIÇÕES DE PAGAMENTO', M, y, 9, bold, grey); y -= 15; para(f.condicoes, 10, reg, dark); y -= 6; }
    if (f.notas) { need(30); text('OBSERVAÇÕES', M, y, 9, bold, grey); y -= 15; para(f.notas, 10, reg, dark); y -= 6; }

    // aceitação
    need(80); y -= 18;
    text('Aceitação do orçamento', M, y, 9, bold, grey); y -= 36;
    page.drawLine({ start: { x: M, y: y }, end: { x: M + 220, y: y }, thickness: 0.6, color: grey });
    page.drawLine({ start: { x: W - M - 150, y: y }, end: { x: W - M, y: y }, thickness: 0.6, color: grey });
    text('Assinatura do cliente', M, y - 12, 8.5, reg, grey);
    text('Data', W - M - 150, y - 12, 8.5, reg, grey);

    var pages = doc.getPages();
    pages.forEach(function (p, i) {
      var ft = (S.s_nome || '') + (S.s_tel ? ' · ' + S.s_tel : '') + (S.s_email ? ' · ' + S.s_email : '');
      p.drawText(safe(ft), { x: M, y: 28, size: 8, font: reg, color: grey });
      var pg = 'Página ' + (i + 1) + ' de ' + pages.length;
      p.drawText(pg, { x: W - M - reg.widthOfTextAtSize(pg, 8), y: 28, size: 8, font: reg, color: grey });
    });

    var bytes = await doc.save();
    var nome = 'Orcamento_' + cur.num.replace('/', '-') + (f.c_nome ? '_' + f.c_nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/_+$/, '') : '') + '.pdf';
    entregar(new Blob([bytes], { type: 'application/pdf' }), nome);
  }
  function entregar(blob, nome) {
    var file;
    try { file = new File([blob], nome, { type: blob.type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: nome }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

// ---------- listas de orçamentos ----------
function pillEstado(e) {
  var cls = e === 'Aceite' || e === 'Concluído' ? 'ok' : e === 'Recusado' ? 'no' : e === 'Enviado' ? 'warn' : '';
  return '<span class="pill ' + cls + '">' + esc(e || 'Por enviar') + '</span>';
}
function orcHTML(items, mostrarCliente) {
  if (!items.length) return '<p class="empty">Ainda não há orçamentos.</p>';
  return items.map(function (x) {
    return '<div class="item"><div class="item-top"><b>' + esc(mostrarCliente ? (x.cliente || 'Sem nome') : 'N.º ' + x.num) + '</b><span>' + eur(x.total) + '</span></div>' +
      '<div class="meta">' + (mostrarCliente ? 'N.º ' + esc(x.num) + ' · ' : '') + dataPT(x.data) + (x.morada ? ' · ' + esc(x.morada) : '') + (x.atualizadoPor ? ' · por ' + esc(x.atualizadoPor) : '') + '</div>' +
      '<div class="row" style="align-items:center"><label for="st' + x.id + '" style="flex:1 1 140px">Estado<select id="st' + x.id + '" data-st="' + x.id + '">' +
      ESTADOS.map(function (e) { return '<option' + (e === (x.estado || 'Por enviar') ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn small" data-open="' + x.id + '">Abrir</button>' +
      '<button type="button" class="btn ghost small" data-dup="' + x.id + '">Duplicar</button>' +
      '<button type="button" class="btn danger small" data-rm="' + x.id + '">Apagar</button></div></div>';
  }).join('');
}
function ligarListaOrc(box) {
  box.addEventListener('change', function (e) {
    var id = e.target.dataset.st; if (!id) return;
    updateDoc(doc(db, 'orcamentos', id), { estado: e.target.value, atualizadoEm: serverTimestamp(), atualizadoPor: perfil.nome || user.email }).catch(function (er) { falhou(er, 'mudar o estado'); });
    if (cur && cur.id === id) cur.estado = e.target.value;
    toast('Estado atualizado.');
  });
  box.addEventListener('click', function (e) {
    var d = e.target.dataset, x;
    if (d.open || d.dup) {
      if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Continuar na mesma?')) return;
      x = orcs.find(function (o) { return o.id === (d.open || d.dup); }); if (!x) return;
      cur = { id: x.id, num: x.num, data: x.data, estado: x.estado || 'Por enviar', f: JSON.parse(JSON.stringify(x.f || {})), extras: JSON.parse(JSON.stringify(x.extras || [])), clienteId: x.clienteId || null };
      if (d.dup) { cur.id = null; cur.num = null; cur.data = null; cur.estado = 'Por enviar'; }
      dirty = !!d.dup; lsSet(K_DRAFT, { q: cur, dirty: dirty }); toForm(cur); show('novo');
      if (d.dup) toast('Cópia criada. Altere o que precisar e guarde.');
    } else if (d.rm) {
      x = orcs.find(function (o) { return o.id === d.rm; }); if (!x) return;
      if (!confirm('Apagar o orçamento ' + x.num + (x.cliente ? ' de ' + x.cliente : '') + '? Não dá para desfazer.')) return;
      deleteDoc(doc(db, 'orcamentos', d.rm)).catch(function (er) { falhou(er, 'apagar o orçamento'); });
      if (cur && cur.id === d.rm) { cur.id = null; cur.num = null; toForm(cur); }
      toast('Orçamento apagado.');
    }
  });
}
ligarListaOrc($('orc-todos'));
ligarListaOrc($('cf-orcs'));

// ---------- clientes ----------
function renderClientes() {
  var q = ($('cli_filtro').value || '').toLowerCase();
  var items = clientes.filter(function (c) { return !q || ((c.nome || '') + ' ' + (c.telefone || '') + ' ' + (c.morada || '')).toLowerCase().indexOf(q) >= 0; });
  $('cli-lista').innerHTML = items.length ? items.map(function (c) {
    var os = orcs.filter(function (o) { return o.clienteId === c.id; });
    return '<button type="button" class="cli" data-cli="' + c.id + '"><span><b>' + esc(c.nome || 'Sem nome') + '</b><span class="meta">' + esc([c.telefone, c.morada].filter(Boolean).join(' · ') || 'Sem contactos') + '</span></span>' +
      '<span style="text-align:right">' + (os.length ? pillEstado(os[0].estado) : '<span class="pill">Sem orçamentos</span>') + '</span></button>';
  }).join('') : '<p class="empty">' + (clientes.length ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes. Carregue em "Novo cliente" ou guarde um orçamento.') + '</p>';
  $('orc-todos').innerHTML = orcHTML(orcs.slice(0, 40), true);
}
$('cli_filtro').addEventListener('input', renderClientes);
$('cli-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-cli]'); if (b) abrirCliente(b.dataset.cli); });
$('b-novocli').addEventListener('click', function () { abrirCliente(null); });
$('b-voltar').addEventListener('click', function () { fecharCliente(); show('clientes'); });

function fecharCliente() { subsCli.forEach(function (u) { u(); }); subsCli = []; clienteAberto = null; pagamentos = []; fotos = []; }
function abrirCliente(id) {
  fecharCliente();
  clienteAberto = id;
  var c = id ? clientes.find(function (x) { return x.id === id; }) || {} : {};
  $('cf-titulo').textContent = id ? (c.nome || 'Cliente') : 'Novo cliente';
  $('cf_nome').value = c.nome || ''; $('cf_tel').value = c.telefone || ''; $('cf_email').value = c.email || '';
  $('cf_nif').value = c.nif || ''; $('cf_morada').value = c.morada || ''; $('cf_notas').value = c.notas || '';
  $('cf-apagar').hidden = !id;
  ['cf-resumo'].forEach(function (s) { $(s).hidden = !id; });
  document.querySelectorAll('#v-cliente > section.card').forEach(function (s, i) { if (i > 0) s.hidden = !id; });
  $('cf-pags').innerHTML = ''; $('cf-fotos').innerHTML = ''; $('f-estado').textContent = '';
  $('p_data').value = hoje();
  if (id) {
    renderCliente();
    subsCli.push(onSnapshot(query(collection(db, 'clientes', id, 'pagamentos'), orderBy('data', 'desc')), function (s) {
      pagamentos = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderPagamentos(); renderKpis();
    }, function (e) { console.warn(e); }));
    subsCli.push(onSnapshot(query(collection(db, 'clientes', id, 'fotos'), orderBy('criadoEm', 'desc')), function (s) {
      fotos = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderFotos();
    }, function (e) { console.warn(e); }));
  }
  show('cliente');
  if (!id) $('cf_nome').focus();
}
function renderCliente() {
  if (!clienteAberto) return;
  var c = clientes.find(function (x) { return x.id === clienteAberto; });
  if (c) $('cf-titulo').textContent = c.nome || 'Cliente';
  $('cf-orcs').innerHTML = orcHTML(orcs.filter(function (o) { return o.clienteId === clienteAberto; }), false);
  renderKpis();
}
function renderKpis() {
  var aceite = orcs.filter(function (o) { return o.clienteId === clienteAberto && (o.estado === 'Aceite' || o.estado === 'Concluído'); }).reduce(function (a, o) { return a + (o.total || 0); }, 0);
  var pago = pagamentos.reduce(function (a, p) { return a + (p.valor || 0); }, 0);
  $('k-aceite').textContent = eur(aceite); $('k-pago').textContent = eur(pago); $('k-falta').textContent = eur(Math.max(aceite - pago, 0));
}
$('cf-guardar').addEventListener('click', function () {
  var nome = $('cf_nome').value.trim();
  if (!nome) { toast('Escreva o nome do cliente.'); $('cf_nome').focus(); return; }
  var dados = { nome: nome, telefone: $('cf_tel').value.trim(), email: $('cf_email').value.trim(), nif: $('cf_nif').value.trim(), morada: $('cf_morada').value.trim(), notas: $('cf_notas').value, atualizadoEm: serverTimestamp() };
  if (clienteAberto) {
    updateDoc(doc(db, 'clientes', clienteAberto), dados).catch(function (e) { falhou(e, 'guardar o cliente'); });
    toast('Dados guardados.');
  } else {
    var ref = doc(collection(db, 'clientes'));
    dados.criadoEm = serverTimestamp(); dados.criadoPor = perfil.nome || user.email;
    setDoc(ref, dados).catch(function (e) { falhou(e, 'criar o cliente'); });
    clientes.push(Object.assign({ id: ref.id }, dados));
    toast('Cliente criado.'); abrirCliente(ref.id);
  }
});
$('cf-apagar').addEventListener('click', async function () {
  var c = clientes.find(function (x) { return x.id === clienteAberto; }); if (!c) return;
  var os = orcs.filter(function (o) { return o.clienteId === c.id; });
  if (!confirm('Apagar o cliente ' + (c.nome || '') + ' com ' + os.length + ' orçamento(s), ' + pagamentos.length + ' pagamento(s) e ' + fotos.length + ' fotografia(s)? Não dá para desfazer.')) return;
  var id = c.id, fs = fotos.slice(), ps = pagamentos.slice();
  fecharCliente(); show('clientes');
  try {
    for (var f of fs) { try { await deleteObject(sRef(storage, f.path)); } catch (e) {} await deleteDoc(doc(db, 'clientes', id, 'fotos', f.id)); }
    for (var p of ps) await deleteDoc(doc(db, 'clientes', id, 'pagamentos', p.id));
    for (var o of os) await deleteDoc(doc(db, 'orcamentos', o.id));
    await deleteDoc(doc(db, 'clientes', id));
    toast('Cliente apagado.');
  } catch (e) { falhou(e, 'apagar tudo'); }
});
$('cf-novoorc').addEventListener('click', function () {
  if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Começar um novo na mesma?')) return;
  cur = blankQuote(clienteAberto); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); show('novo');
});

// pagamentos
function renderPagamentos() {
  $('cf-pags').innerHTML = pagamentos.length ? pagamentos.map(function (p) {
    return '<div class="pag"><span>' + dataPT(p.data) + (p.descricao ? ' · ' + esc(p.descricao) : '') + '<span class="meta">' + (p.por ? ' por ' + esc(p.por) : '') + '</span></span>' +
      '<span>' + eur(p.valor) + ' <button type="button" class="btn danger small" data-rmp="' + p.id + '" aria-label="Apagar pagamento">✕</button></span></div>';
  }).join('') : '<p class="hint">Ainda não há pagamentos registados.</p>';
}
$('cf-pags').addEventListener('click', function (e) {
  var id = e.target.dataset.rmp; if (!id || !confirm('Apagar este pagamento?')) return;
  deleteDoc(doc(db, 'clientes', clienteAberto, 'pagamentos', id)).catch(function (er) { falhou(er, 'apagar o pagamento'); });
});
$('p-add').addEventListener('click', function () {
  var v = num($('p_valor').value);
  if (!v) { toast('Escreva o valor do pagamento.'); $('p_valor').focus(); return; }
  setDoc(doc(collection(db, 'clientes', clienteAberto, 'pagamentos')), { data: $('p_data').value || hoje(), valor: v, descricao: $('p_desc').value.trim(), por: perfil.nome || user.email, criadoEm: serverTimestamp() }).catch(function (er) { falhou(er, 'registar o pagamento'); });
  $('p_valor').value = ''; $('p_desc').value = ''; toast('Pagamento registado.');
});

// fotografias
function renderFotos() {
  $('cf-fotos').innerHTML = fotos.length ? fotos.map(function (f) {
    return '<div class="foto"><a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="Fotografia ' + esc(f.fase || '') + '" loading="lazy"></a><span>' + esc(f.fase || '') + '</span><button type="button" data-rmf="' + f.id + '" aria-label="Apagar fotografia">✕</button></div>';
  }).join('') : '<p class="hint">Ainda não há fotografias.</p>';
}
$('cf-fotos').addEventListener('click', async function (e) {
  var id = e.target.dataset.rmf; if (!id) return;
  e.preventDefault();
  if (!confirm('Apagar esta fotografia?')) return;
  var f = fotos.find(function (x) { return x.id === id; });
  try { if (f && f.path) await deleteObject(sRef(storage, f.path)); } catch (er) { console.warn(er); }
  deleteDoc(doc(db, 'clientes', clienteAberto, 'fotos', id)).catch(function (er) { falhou(er, 'apagar a fotografia'); });
});
async function comprimir(file) {
  var max = 1600, img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { img = await new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ko; i.src = URL.createObjectURL(file); }); }
  var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
  var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.8); });
}
$('f_ficheiros').addEventListener('change', async function (e) {
  var files = [].slice.call(e.target.files || []); e.target.value = '';
  if (!files.length || !clienteAberto) return;
  var id = clienteAberto, fase = $('f_fase').value, est = $('f-estado');
  for (var i = 0; i < files.length; i++) {
    est.textContent = 'A enviar fotografia ' + (i + 1) + ' de ' + files.length + '…';
    try {
      var blob = await comprimir(files[i]);
      var path = 'clientes/' + id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';
      var task = uploadBytesResumable(sRef(storage, path), blob, { contentType: 'image/jpeg' });
      await new Promise(function (ok, ko) {
        task.on('state_changed', function (s) { est.textContent = 'A enviar fotografia ' + (i + 1) + ' de ' + files.length + ' (' + Math.round(s.bytesTransferred / s.totalBytes * 100) + ' %)…'; }, ko, ok);
      });
      var url = await getDownloadURL(task.snapshot.ref);
      await setDoc(doc(collection(db, 'clientes', id, 'fotos')), { path: path, url: url, fase: fase, por: perfil.nome || user.email, criadoEm: serverTimestamp() });
    } catch (er) {
      console.error(er);
      est.textContent = er && (er.code === 'storage/unknown' || er.code === 'storage/bucket-not-found' || er.code === 'storage/project-not-found' || er.code === 'storage/unauthorized')
        ? 'As fotografias ainda não estão ativas. Falta ativar o armazenamento de ficheiros no Firebase.'
        : 'Não foi possível enviar a fotografia. Verifique a internet e tente outra vez.';
      return;
    }
  }
  est.textContent = files.length === 1 ? 'Fotografia enviada.' : files.length + ' fotografias enviadas.';
});

// ---------- definições ----------
function preencherDef() {
  CFG_FIELDS.forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = config[k] == null ? (k === 's_iva' ? '0' : '') : config[k]; });
  if (!$('s_nome').value) $('s_nome').value = 'VisoThermLy';
  if (document.activeElement !== $('u_nome')) $('u_nome').value = perfil.nome || '';
  if (document.activeElement !== $('u_tel')) $('u_tel').value = perfil.telefone || '';
  $('equipa').innerHTML = membros.map(function (m) { return '<div class="item-top" style="padding:6px 0"><span><b>' + esc(m.nome || 'Sem nome') + '</b> <span class="meta">' + esc(m.email || '') + '</span></span></div>'; }).join('');
}
$('s-guardar').addEventListener('click', function () {
  var d = {}; CFG_FIELDS.forEach(function (k) { d[k] = $(k).value; });
  setDoc(doc(db, 'config', 'geral'), d, { merge: true }).catch(function (e) { falhou(e, 'guardar os dados da empresa'); });
  toast('Dados da empresa guardados para toda a equipa.');
});
$('u-guardar').addEventListener('click', function () {
  updateDoc(doc(db, 'membros', user.uid), { nome: $('u_nome').value.trim(), telefone: $('u_tel').value.trim() }).catch(function (e) { falhou(e, 'guardar o perfil'); });
  toast('Perfil guardado.');
});
$('b-sair').addEventListener('click', function () { if (confirm('Terminar a sessão neste telemóvel?')) signOut(auth); });

// importar orçamentos da versão anterior (guardados só neste telemóvel)
function verImport() {
  var old = lsGet('vt-orcamentos', []);
  var ja = lsGet('vt-importado', false);
  $('sec-import').hidden = !(old.length && !ja);
  $('imp-txt').textContent = old.length + ' orçamento(s) da versão anterior estão guardados só neste telemóvel. Passe-os para a equipa para ficarem nas pastas dos clientes.';
}
$('b-import').addEventListener('click', async function () {
  var old = lsGet('vt-orcamentos', []); if (!old.length) return;
  var b = $('b-import'); b.disabled = true;
  try {
    var mapa = {};
    clientes.forEach(function (c) { mapa[(c.nome || '').trim().toLowerCase()] = c.id; });
    for (var o of old) {
      var nome = ((o.f && o.f.c_nome) || o.cliente || 'Sem nome').trim(), key = nome.toLowerCase();
      if (!mapa[key]) {
        var cref = doc(collection(db, 'clientes'));
        await setDoc(cref, { nome: nome, telefone: (o.f && o.f.c_tel) || '', nif: (o.f && o.f.c_nif) || '', morada: (o.f && o.f.o_morada) || '', email: '', notas: '', criadoEm: serverTimestamp(), criadoPor: perfil.nome || user.email });
        mapa[key] = cref.id;
      }
      await setDoc(doc(collection(db, 'orcamentos')), { num: o.num, data: o.data || hoje(), estado: o.estado || 'Por enviar', f: o.f || {}, extras: o.extras || [], clienteId: mapa[key], cliente: nome, morada: (o.f && o.f.o_morada) || '', total: o.total || 0, atualizadoEm: serverTimestamp(), atualizadoPor: perfil.nome || user.email });
    }
    var oldSet = lsGet('vt-definicoes', {});
    if (!config.s_nif && !config.s_isencao && Object.keys(oldSet).length) {
      var d = {}; CFG_FIELDS.forEach(function (k) { if (oldSet[k]) d[k] = oldSet[k]; });
      await setDoc(doc(db, 'config', 'geral'), d, { merge: true });
    }
    lsSet('vt-importado', true); verImport();
    toast(old.length + ' orçamento(s) passados para a equipa.');
  } catch (e) { falhou(e, 'passar os orçamentos'); }
  b.disabled = false;
});

// ---------- entrar ----------
var modoCriar = false;
function msgErro(e) {
  var c = e && e.code || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return 'Email ou palavra-passe errados.';
  if (c === 'auth/email-already-in-use') return 'Já existe uma conta com este email. Escolha "Entrar".';
  if (c === 'auth/weak-password') return 'A palavra-passe tem de ter pelo menos 6 caracteres.';
  if (c === 'auth/invalid-email') return 'O email não está bem escrito.';
  if (c === 'auth/network-request-failed') return 'Sem internet. Ligue-se e tente outra vez.';
  if (c === 'auth/too-many-requests') return 'Demasiadas tentativas. Espere uns minutos.';
  if (c === 'permission-denied') return 'Código da equipa errado.';
  return 'Não foi possível continuar (' + (c || 'erro') + ').';
}
function erro(id, txt) { var el = $(id); el.textContent = txt || ''; el.hidden = !txt; }
$('l-modo').addEventListener('click', function () {
  modoCriar = !modoCriar;
  $('l-titulo').textContent = modoCriar ? 'Criar conta' : 'Entrar';
  $('l-ok').textContent = modoCriar ? 'Criar conta' : 'Entrar';
  $('l-modo').textContent = modoCriar ? 'Já tenho conta' : 'Criar conta';
  $('l-extra').hidden = !modoCriar; $('l_pass').autocomplete = modoCriar ? 'new-password' : 'current-password';
  erro('l-err', '');
});
$('l-ok').addEventListener('click', async function () {
  var email = $('l_email').value.trim(), pass = $('l_pass').value;
  if (!email || !pass) { erro('l-err', 'Escreva o email e a palavra-passe.'); return; }
  if (modoCriar && !$('l_codigo').value.trim()) { erro('l-err', 'Escreva o código da equipa.'); return; }
  erro('l-err', ''); $('l-ok').disabled = true;
  try {
    if (modoCriar) {
      sessionStorage.setItem('vt-junta', JSON.stringify({ nome: $('l_nome').value.trim(), codigo: $('l_codigo').value.trim().toUpperCase() }));
      await createUserWithEmailAndPassword(auth, email, pass);
    } else await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) { erro('l-err', msgErro(e)); }
  $('l-ok').disabled = false;
});
$('l-reset').addEventListener('click', async function () {
  var email = $('l_email').value.trim();
  if (!email) { erro('l-err', 'Escreva primeiro o seu email.'); return; }
  try { await sendPasswordResetEmail(auth, email); toast('Enviámos um email para mudar a palavra-passe.'); }
  catch (e) { erro('l-err', msgErro(e)); }
});
async function juntar(nome, codigo) {
  await setDoc(doc(db, 'membros', user.uid), { codigo: codigo, nome: nome || user.email.split('@')[0], email: user.email, telefone: '', criadoEm: serverTimestamp() });
}
$('j-ok').addEventListener('click', async function () {
  var codigo = $('j_codigo').value.trim().toUpperCase();
  if (!codigo) { erro('j-err', 'Escreva o código da equipa.'); return; }
  erro('j-err', ''); $('j-ok').disabled = true;
  try { await juntar($('j_nome').value.trim(), codigo); await arrancar(); }
  catch (e) { erro('j-err', msgErro(e)); }
  $('j-ok').disabled = false;
});
$('j-sair').addEventListener('click', function () { signOut(auth); });

function ecran(qual) {
  $('v-login').hidden = qual !== 'login'; $('v-codigo').hidden = qual !== 'codigo'; $('app').hidden = qual !== 'app';
}
function parar() { subs.forEach(function (u) { u(); }); subs = []; fecharCliente(); }

onAuthStateChanged(auth, async function (u) {
  parar();
  user = u;
  if (!u) { ecran('login'); return; }
  var pend = null; try { pend = JSON.parse(sessionStorage.getItem('vt-junta')); } catch (e) {}
  sessionStorage.removeItem('vt-junta');
  if (pend && pend.codigo) {
    try { await juntar(pend.nome, pend.codigo); }
    catch (e) { ecran('codigo'); $('j_nome').value = pend.nome || ''; erro('j-err', msgErro(e)); return; }
  }
  try {
    var m = await getDoc(doc(db, 'membros', u.uid));
    if (!m.exists()) { ecran('codigo'); return; }
  } catch (e) {
    if (e.code === 'permission-denied') { ecran('codigo'); return; }
    // sem internet: confiar na sessão guardada
  }
  await arrancar();
});

async function arrancar() {
  ecran('app');
  subs.push(onSnapshot(doc(db, 'membros', user.uid), function (s) { perfil = s.exists() ? s.data() : {}; $('quem').textContent = perfil.nome || user.email; recalcSettings(); preencherDef(); }, function (e) { console.warn(e); }));
  subs.push(onSnapshot(doc(db, 'config', 'geral'), function (s) { config = s.exists() ? s.data() : {}; recalcSettings(); preencherDef(); }, function (e) { console.warn(e); }));
  subs.push(onSnapshot(collection(db, 'membros'), function (s) { membros = s.docs.map(function (d) { return d.data(); }); preencherDef(); }, function (e) { console.warn(e); }));
  subs.push(onSnapshot(query(collection(db, 'clientes'), orderBy('nome')), function (s) {
    clientes = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    renderClientes(); renderClienteSelect(); renderCliente();
  }, function (e) { console.warn(e); }));
  subs.push(onSnapshot(query(collection(db, 'orcamentos'), orderBy('data', 'desc')), function (s) {
    orcs = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    orcs.sort(function (a, b) { return (b.data || '').localeCompare(a.data || '') || (b.num || '').localeCompare(a.num || ''); });
    renderClientes(); renderCliente();
  }, function (e) { console.warn(e); }));
  recalcSettings();
  var draft = lsGet(K_DRAFT, null);
  if (draft && draft.q && draft.q.f) { cur = draft.q; if (!cur.extras) cur.extras = []; dirty = !!draft.dirty; }
  else cur = blankQuote();
  toForm(cur);
  verImport();
  show('clientes');
}

if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
$('b-pdf').addEventListener('click', function () { gerarPDF().catch(function (e) { console.error(e); toast('Não foi possível gerar o PDF.'); }); });
