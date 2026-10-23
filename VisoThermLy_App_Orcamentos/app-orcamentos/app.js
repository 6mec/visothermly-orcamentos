import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, runTransaction, query, orderBy, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const fbApp = initializeApp(window.VT_FIREBASE);
const auth = getAuth(fbApp);
let db;
try { db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(fbApp, {}); }

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
var vistaAtual = 'inicio';
var VISTAS = ['inicio', 'clientes', 'cliente', 'obras', 'obra', 'orcs', 'novo', 'mais', 'despesas', 'dias', 'contas', 'docs', 'def'];
var NAV_DE = { cliente: 'clientes', obra: 'obras', novo: 'orcs', despesas: 'mais', dias: 'mais', contas: 'mais', docs: 'mais', def: 'mais' };
function iniciais(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function corDe(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return 'hsl(' + h + ',45%,42%)'; }
function avatar(nome, big) { return '<span class="av' + (big ? ' big' : '') + '" style="background:' + corDe(nome) + '">' + esc(iniciais(nome)) + '</span>'; }
function cabecalho() {
  var t = 'Clientes', s = clientes.length + (clientes.length === 1 ? ' cliente' : ' clientes') + ' · ' + orcs.length + (orcs.length === 1 ? ' orçamento' : ' orçamentos');
  if (vistaAtual === 'cliente') { var c = clientes.find(function (x) { return x.id === clienteAberto; }); t = clienteAberto ? (c && c.nome || 'Cliente') : 'Novo cliente'; s = 'Pasta do cliente'; }
  else if (vistaAtual === 'novo') { t = cur && cur.num ? 'Orçamento ' + cur.num : 'Novo orçamento'; s = cur && cur.f && cur.f.c_nome ? cur.f.c_nome : 'Capoto & isolamento térmico'; }
  else if (vistaAtual === 'def') { t = 'Definições'; s = 'Perfil, empresa, equipa e consumos'; }
  else if (vistaAtual === 'inicio') { var hr = new Date().getHours(); t = (hr < 13 ? 'Bom dia' : hr < 20 ? 'Boa tarde' : 'Boa noite') + (perfil.nome ? ', ' + perfil.nome.split(' ')[0] : ''); s = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }); }
  else if (vistaAtual === 'obras') { var nc = obras.filter(function (o) { return o.estado === 'Em curso'; }).length; t = 'Obras'; s = obras.length + (obras.length === 1 ? ' obra' : ' obras') + ' · ' + nc + ' em curso'; }
  else if (vistaAtual === 'obra') { var ob = obras.find(function (x) { return x.id === obraAberta; }); t = ob ? ob.nome : 'Obra'; s = ob ? (ob.estado || 'Planeada') + (ob.cliente ? ' · ' + ob.cliente : '') : ''; }
  else if (vistaAtual === 'orcs') { t = 'Orçamentos'; s = orcs.length + (orcs.length === 1 ? ' orçamento' : ' orçamentos'); }
  else if (vistaAtual === 'mais') { t = 'Mais'; s = 'Gestão da empresa'; }
  else if (vistaAtual === 'despesas') { t = 'Despesas'; s = 'Combustível, material e outros gastos'; }
  else if (vistaAtual === 'dias') { t = 'Equipa e dias'; s = 'Quem trabalhou, onde e quanto'; }
  else if (vistaAtual === 'contas') { t = 'Contas'; s = 'Recebido, gasto e resultado'; }
  else if (vistaAtual === 'docs') { t = 'Documentos'; s = 'Seguros, alvarás e validades'; }
  $('h-titulo').textContent = t; $('h-sub').textContent = s;
}
function show(v) {
  vistaAtual = v;
  if (v !== 'obra' && obraAberta) fecharObra();
  VISTAS.forEach(function (x) { $('v-' + x).hidden = x !== v; });
  if (v === 'inicio') renderInicio(); else if (v === 'obras') renderObras(); else if (v === 'orcs') renderOrcs();
  else if (v === 'despesas') { if (!$('dsp_mes').value) $('dsp_mes').value = mesAtual(); renderDespesas(); }
  else if (v === 'dias') { if (!$('dias_mes').value) $('dias_mes').value = mesAtual(); renderDias(); }
  else if (v === 'contas') renderContas(); else if (v === 'docs') renderDocs(); else if (v === 'def') preencherConsumos();
  cabecalho();
  var navV = NAV_DE[v] || v;
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
  renderMed();
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
    $('bt-val').textContent = eur(r.total); $('bt-lbl').textContent = r.taxa ? 'Total com IVA' : 'Total';
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
      num: cur.num, data: cur.data, estado: cur.estado || 'Por enviar', f: cur.f, extras: cur.extras, medicao: cur.medicao || null,
      clienteId: cur.clienteId, cliente: f.c_nome.trim(), morada: f.o_morada || '', total: r.total,
      atualizadoEm: serverTimestamp(), atualizadoPor: perfil.nome || user.email
    }).catch(function (e) { falhou(e, 'guardar o orçamento'); });
    dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur);
    toast('Orçamento ' + cur.num + ' guardado' + (navigator.onLine ? '.' : '. Será enviado para a equipa quando houver internet.'));
    return true;
  } finally { btn.disabled = false; }
}
$('b-guardar').addEventListener('click', function () { guardar().then(cabecalho); });
$('bt-guardar').addEventListener('click', function () { guardar().then(cabecalho); });
$('bt-pdf').addEventListener('click', function () { $('b-pdf').click(); });
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
var IC_DUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var IC_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
function estClasse(e) { return e === 'Aceite' || e === 'Concluído' ? 'ok' : e === 'Recusado' ? 'no' : e === 'Enviado' ? 'warn' : 'neutro'; }
function orcHTML(items, mostrarCliente) {
  if (!items.length) return '<p class="empty">Ainda não há orçamentos.</p>';
  return items.map(function (x) {
    return '<div class="item"><div class="item-top"><b>' + esc(mostrarCliente ? (x.cliente || 'Sem nome') : 'N.º ' + x.num) + '</b><span>' + eur(x.total) + '</span></div>' +
      '<div class="meta">' + (mostrarCliente ? 'N.º ' + esc(x.num) + ' · ' : '') + dataPT(x.data) + (x.morada ? ' · ' + esc(x.morada) : '') + (x.atualizadoPor ? ' · por ' + esc(x.atualizadoPor) : '') + '</div>' +
      '<div class="oacts"><label for="st' + x.id + '" class="sr">Estado</label><select id="st' + x.id + '" data-st="' + x.id + '" class="est est-' + estClasse(x.estado) + '">' +
      ESTADOS.map(function (e) { return '<option' + (e === (x.estado || 'Por enviar') ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn small" data-open="' + x.id + '">Abrir</button>' +
      ((x.estado === 'Aceite' || x.estado === 'Concluído') ? '<button type="button" class="btn acc small" data-mkobra="' + x.id + '">' + (obras.some(function (b) { return b.orcamentoId === x.id; }) ? 'Ver obra' : 'Criar obra') + '</button>' : '') +
      '<button type="button" class="btn ghost small ico" data-dup="' + x.id + '" aria-label="Duplicar" title="Duplicar">' + IC_DUP + '</button>' +
      '<button type="button" class="btn danger small ico" data-rm="' + x.id + '" aria-label="Apagar" title="Apagar">' + IC_DEL + '</button></div></div>';
  }).join('');
}
function ligarListaOrc(box) {
  box.addEventListener('change', function (e) {
    var id = e.target.dataset.st; if (!id) return;
    var up = { estado: e.target.value, atualizadoEm: serverTimestamp(), atualizadoPor: perfil.nome || user.email };
    if (e.target.value === 'Enviado') up.enviadoEm = hoje();
    updateDoc(doc(db, 'orcamentos', id), up).catch(function (er) { falhou(er, 'mudar o estado'); });
    if (cur && cur.id === id) cur.estado = e.target.value;
    var ox = orcs.find(function (o) { return o.id === id; });
    if (e.target.value === 'Aceite' && ox && !obras.some(function (b) { return b.orcamentoId === id; }) && confirm('Orçamento aceite! Criar já a obra para planear datas, equipa e material?')) { ox.estado = 'Aceite'; criarObraDeOrc(ox); return; }
    toast('Estado atualizado.');
  });
  box.addEventListener('click', function (e) {
    var d = e.target.dataset, x;
    if (d.mkobra) { x = orcs.find(function (o) { return o.id === d.mkobra; }); if (x) criarObraDeOrc(x); return; }
    if (d.open || d.dup) {
      if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Continuar na mesma?')) return;
      x = orcs.find(function (o) { return o.id === (d.open || d.dup); }); if (!x) return;
      cur = { id: x.id, num: x.num, data: x.data, estado: x.estado || 'Por enviar', f: JSON.parse(JSON.stringify(x.f || {})), extras: JSON.parse(JSON.stringify(x.extras || [])), clienteId: x.clienteId || null, medicao: x.medicao ? JSON.parse(JSON.stringify(x.medicao)) : null };
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
    return '<button type="button" class="cli" data-cli="' + c.id + '"><span class="cli-l">' + avatar(c.nome) + '<span style="min-width:0"><b>' + esc(c.nome || 'Sem nome') + '</b><span class="meta">' + esc([c.telefone, c.morada].filter(Boolean).join(' · ') || 'Sem contactos') + '</span></span></span>' +
      '<span style="text-align:right">' + (os.length ? pillEstado(os[0].estado) : '<span class="pill">Sem orçamentos</span>') + '</span></button>';
  }).join('') : '<p class="empty">' + (clientes.length ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes. Carregue em "Novo cliente" ou guarde um orçamento.') + '</p>';
  cabecalho();
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
  $('cf-det').open = !id;
  $('cf-apagar').hidden = !id;
  fichaTopo(c);
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
function fichaTopo(c) {
  c = c || {};
  var av = $('cf-av'); av.textContent = iniciais(c.nome || '+'); av.style.background = corDe(c.nome || '');
  $('cf-sub').textContent = [c.telefone, c.morada].filter(Boolean).join(' · ') || (clienteAberto ? 'Sem contactos' : 'Preencha os dados e guarde');
  var tel = String(c.telefone || '').replace(/[^\d+]/g, '');
  $('cf-acoes').hidden = !tel;
  if (tel) {
    $('cf-ligar').href = 'tel:' + tel;
    var wa = tel.replace(/^\+/, ''); if (wa.length === 9) wa = '351' + wa;
    $('cf-wa').href = 'https://wa.me/' + wa;
  }
}
function renderCliente() {
  if (!clienteAberto) return;
  var c = clientes.find(function (x) { return x.id === clienteAberto; });
  if (c) { $('cf-titulo').textContent = c.nome || 'Cliente'; fichaTopo(c); cabecalho(); }
  renderObrasCliente();
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
    for (var f of fs) { try { await deleteDoc(doc(db, 'clientes', id, 'fotosFull', f.id)); } catch (e) {} await deleteDoc(doc(db, 'clientes', id, 'fotos', f.id)); }
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
    return '<div class="foto"><a href="#" data-verf="' + f.id + '"><img src="' + esc(f.thumb || f.url || '') + '" alt="Fotografia ' + esc(f.fase || '') + '" loading="lazy" style="pointer-events:none"></a><span>' + esc(f.fase || '') + '</span><button type="button" data-rmf="' + f.id + '" aria-label="Apagar fotografia">✕</button></div>';
  }).join('') : '<p class="hint">Ainda não há fotografias.</p>';
}
$('cf-fotos').addEventListener('click', async function (e) {
  var vf = e.target.closest('[data-verf]');
  if (vf) { e.preventDefault(); verFoto(vf.dataset.verf); return; }
  var id = e.target.dataset.rmf; if (!id) return;
  e.preventDefault();
  if (!confirm('Apagar esta fotografia?')) return;
  var f = fotos.find(function (x) { return x.id === id; });
  deleteDoc(doc(db, 'clientes', clienteAberto, 'fotosFull', id)).catch(function () {});
  deleteDoc(doc(db, 'clientes', clienteAberto, 'fotos', id)).catch(function (er) { falhou(er, 'apagar a fotografia'); });
});
async function verFoto(id) {
  var f = fotos.find(function (x) { return x.id === id; }); if (!f) return;
  abrirDlg((f.fase || 'Fotografia') + (f.por ? ' · ' + f.por : ''), '<p class="hint">A abrir…</p>', []);
  var src = f.url || '';
  try { var d = await getDoc(doc(db, 'clientes', clienteAberto, 'fotosFull', id)); if (d.exists() && d.data().img) src = d.data().img; } catch (e) { console.warn(e); }
  if (!src) src = f.thumb || '';
  $('dlg-b').innerHTML = '<img src="' + esc(src) + '" alt="Fotografia" style="width:100%;border-radius:12px;display:block">' + (f.criadoEm ? '<p class="hint">' + esc(String(f.criadoEm.toDate ? f.criadoEm.toDate().toLocaleString('pt-PT') : '')) + '</p>' : '');
}
async function imgData(img, max, q0, limite) {
  var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
  var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  var q = q0, u = c.toDataURL('image/jpeg', q);
  while (u.length > limite && q > 0.35) { q -= 0.1; u = c.toDataURL('image/jpeg', q); }
  return u;
}
async function abrirImg(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { return await new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ko; i.src = URL.createObjectURL(file); }); }
}
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
      var img = await abrirImg(files[i]);
      var full = await imgData(img, 1280, 0.72, 700000);
      var thumb = await imgData(img, 360, 0.7, 60000);
      var fref = doc(collection(db, 'clientes', id, 'fotos'));
      await setDoc(doc(db, 'clientes', id, 'fotosFull', fref.id), { img: full });
      await setDoc(fref, { thumb: thumb, fase: fase, por: perfil.nome || user.email, criadoEm: serverTimestamp() });
    } catch (er) {
      console.error(er);
      est.textContent = 'Não foi possível enviar a fotografia. Verifique a internet e tente outra vez.';
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
  preencherConsumos();
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
$('b-backup').addEventListener('click', async function () {
  var b = $('b-backup'); b.disabled = true; b.textContent = 'A preparar…';
  try {
    var out = { app: 'VisoThermLy', exportadoEm: new Date().toISOString(), por: porQuem(), config: config, clientes: [], orcamentos: orcs, pedidos: pedidos, obras: [], despesas: despesas, dias: dias, documentos: documentos };
    for (var c of clientes) { var ps = await getDocs(collection(db, 'clientes', c.id, 'pagamentos')); out.clientes.push(Object.assign({}, c, { pagamentos: ps.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }) })); }
    for (var o of obras) { var di = await getDocs(collection(db, 'obras', o.id, 'diario')); out.obras.push(Object.assign({}, o, { diario: di.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }) })); }
    var txt = JSON.stringify(out, function (k, v) { return v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v; }, 1);
    var blob = new Blob([txt], { type: 'application/json' }), nome = 'VisoThermLy_copia_' + hoje() + '.json';
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Cópia de segurança descarregada.');
  } catch (e) { falhou(e, 'fazer a cópia'); }
  finally { b.disabled = false; b.textContent = 'Descarregar cópia de segurança'; }
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

// =====================================================================
// MÓDULOS DA EMPRESA: pedidos, obras, agenda, despesas, dias, contas,
// documentos, painel e medição
// =====================================================================
var pedidos = [], obras = [], despesas = [], dias = [], documentos = [], todosPag = [];
var obraAberta = null, diario = [], subsObra = [];
var ORIGENS = ['Telefone', 'WhatsApp', 'Google', 'Facebook / Instagram', 'Recomendação', 'Placa numa obra', 'Outro'];
var EST_PED = ['Novo', 'Visita marcada', 'Orçamentado', 'Perdido'];
var EST_OBRA = ['Planeada', 'Em curso', 'Parada', 'Concluída'];
var CAT_DSP = ['Combustível', 'Material', 'Ferramenta e equipamento', 'Aluguer (andaimes, máquinas)', 'Refeições', 'Portagens e estacionamento', 'Seguros e licenças', 'Outros'];
var TIPOS_DIA = ['Trabalho normal', 'Parado – chuva', 'Parado – frio', 'Falta de material', 'Visita do cliente', 'Outro'];
var FASES = [['suporte', 'Preparação e limpeza do suporte'], ['arranque', 'Perfis de arranque'], ['colagem', 'Colagem das placas'], ['fixacao', 'Fixação mecânica (buchas)'], ['reforcos', 'Reforços em cantos e vãos'], ['barramento', 'Barramento armado com rede'], ['primario', 'Primário'], ['acabamento', 'Revestimento de acabamento'], ['remates', 'Remates, limpeza e entrega']];
var K_DEF = { k_placa: '5', k_cola: '4,5', k_barr: '4', k_rede: '1,1', k_buch: '6', k_prim: '0,2', k_acab: '2,5', k_saco: '25', k_rolo: '50', k_balde: '25' };
var K_FIELDS = Object.keys(K_DEF);

function porQuem() { return perfil.nome || (user && user.email) || ''; }
function mesAtual() { return hoje().slice(0, 7); }
function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
function nomeMes(ym) { var m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; var p = ym.split('-'); return m[+p[1] - 1] + ' ' + p[0]; }
function telLinks(tel) {
  var t = String(tel || '').replace(/[^\d+]/g, ''); if (!t) return '';
  var wa = t.replace(/^\+/, ''); if (wa.length === 9) wa = '351' + wa;
  return '<a class="btn ghost small" href="tel:' + t + '">Ligar</a><a class="btn ghost small" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">WhatsApp</a>';
}
function mapaLink(m) { return m ? '<a class="btn ghost small" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(m) + '" target="_blank" rel="noopener">Mapa</a>' : ''; }
function opts(lista, sel) { return lista.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
function campo(id, label, val, tipo, extra) { return '<label for="' + id + '">' + label + '<input id="' + id + '" type="' + (tipo || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></label>'; }
function campoSel(id, label, lista, sel) { return '<label for="' + id + '">' + label + '<select id="' + id + '">' + opts(lista, sel) + '</select></label>'; }
function campoTxt(id, label, val, ph) { return '<label for="' + id + '">' + label + '<textarea id="' + id + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(val || '') + '</textarea></label>'; }
function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
function pill(txt, cls) { return '<span class="pill ' + (cls || '') + '">' + esc(txt) + '</span>'; }
function obrasOpts(sel) { return [['', 'Sem obra']].concat(obras.filter(function (o) { return o.estado !== 'Concluída' || o.id === sel; }).map(function (o) { return [o.id, o.nome]; })); }
function pessoas() { var s = {}; membros.forEach(function (m) { if (m.nome) s[m.nome] = 1; }); (config.pessoasExtra || []).forEach(function (n) { s[n] = 1; }); return Object.keys(s); }

// ---------- diálogo ----------
var dlgAcoes = [];
function abrirDlg(titulo, corpo, acoes) {
  $('dlg-t').textContent = titulo; $('dlg-b').innerHTML = corpo;
  dlgAcoes = acoes || [];
  $('dlg-f').innerHTML = dlgAcoes.map(function (a, i) { return '<button type="button" class="btn ' + (a.cls || '') + '" data-dlg="' + i + '">' + a.txt + '</button>'; }).join('');
  var d = $('dlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  var first = d.querySelector('.dlg-b input, .dlg-b select, .dlg-b textarea'); if (first && !('ontouchstart' in window)) first.focus();
}
function fecharDlg() { var d = $('dlg'); if (d.close) d.close(); else d.removeAttribute('open'); }
$('dlg-x').addEventListener('click', fecharDlg);
$('dlg-f').addEventListener('click', async function (e) {
  var b = e.target.closest('[data-dlg]'); if (!b) return;
  var a = dlgAcoes[+b.dataset.dlg]; if (!a) return;
  var r = await a.fn(); if (r !== false) fecharDlg();
});

// ---------- segmentos ----------
document.querySelectorAll('[data-seg]').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('[data-seg]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    $('seg-cli').hidden = b.dataset.seg !== 'cli'; $('seg-ped').hidden = b.dataset.seg !== 'ped';
  });
});
document.querySelectorAll('[data-oseg]').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('[data-oseg]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    $('oseg-lista').hidden = b.dataset.oseg !== 'lista'; $('oseg-agenda').hidden = b.dataset.oseg !== 'agenda';
    if (b.dataset.oseg === 'agenda') renderAgenda();
  });
});
document.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.go); }); });
document.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.back); }); });

// ---------- pedidos ----------
function pedCls(e) { return e === 'Orçamentado' ? 'ok' : e === 'Perdido' ? 'no' : e === 'Visita marcada' ? 'warn' : ''; }
function renderPedidos() {
  var ordem = { 'Novo': 0, 'Visita marcada': 1, 'Orçamentado': 2, 'Perdido': 3 };
  var it = pedidos.slice().sort(function (a, b) { return (ordem[a.estado] || 0) - (ordem[b.estado] || 0) || (b.data || '').localeCompare(a.data || ''); });
  $('ped-lista').innerHTML = it.length ? it.map(function (p) {
    var vis = p.visita ? 'Visita ' + dataPT(p.visita) + (p.hora ? ' às ' + p.hora : '') : (p.origem || 'Sem visita marcada');
    return '<button type="button" class="row-i" data-ped="' + p.id + '">' + avatar(p.nome) + '<span class="grow"><b>' + esc(p.nome || 'Sem nome') + '</b><span class="meta">' + esc(vis) + (p.morada ? ' · ' + esc(p.morada) : '') + '</span></span><span class="end">' + pill(p.estado || 'Novo', pedCls(p.estado)) + '</span><span class="chev"></span></button>';
  }).join('') : '<p class="empty">Sem pedidos. Registe aqui quem liga ou manda mensagem a pedir orçamento.</p>';
  var n = pedidos.filter(function (p) { return p.estado === 'Novo' || p.estado === 'Visita marcada' || !p.estado; }).length;
  $('ped-badge').hidden = !n; $('ped-badge').textContent = n;
}
$('ped-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-ped]'); if (b) dlgPedido(b.dataset.ped); });
$('b-novoped').addEventListener('click', function () { dlgPedido(null); });
function dlgPedido(id) {
  var p = id ? pedidos.find(function (x) { return x.id === id; }) || {} : { data: hoje(), estado: 'Novo' };
  var corpo = '<div class="grid">' + campo('pd_nome', 'Nome', p.nome) + campo('pd_tel', 'Telefone', p.telefone, 'tel') + '</div>' +
    campo('pd_morada', 'Morada da obra', p.morada) +
    '<div class="grid">' + campoSel('pd_origem', 'Como chegou', ORIGENS, p.origem || 'Telefone') + campoSel('pd_estado', 'Estado', EST_PED, p.estado || 'Novo') + '</div>' +
    '<div class="grid">' + campo('pd_visita', 'Visita (dia)', p.visita, 'date') + campo('pd_hora', 'Hora', p.hora, 'time') + '</div>' +
    campoTxt('pd_desc', 'O que pretende', p.descricao, 'Ex.: moradia de 2 pisos, capoto em todas as fachadas') +
    (id ? '<div class="row">' + telLinks(p.telefone) + mapaLink(p.morada) + '</div>' : '');
  var acoes = [];
  if (id) acoes.push({ txt: 'Apagar', cls: 'danger', fn: function () { if (!confirm('Apagar este pedido?')) return false; deleteDoc(doc(db, 'pedidos', id)).catch(function (e) { falhou(e, 'apagar o pedido'); }); } });
  if (!p.clienteId) acoes.push({ txt: 'Passar a cliente e orçamento', cls: 'ghost', fn: function () { var d = lerPedido(); if (!d) return false; converterPedido(id, d); } });
  acoes.push({ txt: 'Guardar', cls: 'acc', fn: function () { var d = lerPedido(); if (!d) return false; gravarPedido(id, d); toast('Pedido guardado.'); } });
  abrirDlg(id ? 'Pedido' : 'Novo pedido', corpo, acoes);
}
function lerPedido() {
  var d = { nome: val('pd_nome'), telefone: val('pd_tel'), morada: val('pd_morada'), origem: val('pd_origem'), estado: val('pd_estado'), visita: val('pd_visita'), hora: val('pd_hora'), descricao: val('pd_desc') };
  if (!d.nome) { toast('Escreva o nome.'); $('pd_nome').focus(); return null; }
  if (d.visita && d.estado === 'Novo') d.estado = 'Visita marcada';
  return d;
}
function gravarPedido(id, d) {
  d.atualizadoEm = serverTimestamp();
  if (id) updateDoc(doc(db, 'pedidos', id), d).catch(function (e) { falhou(e, 'guardar o pedido'); });
  else { d.data = hoje(); d.criadoEm = serverTimestamp(); d.criadoPor = porQuem(); var r = doc(collection(db, 'pedidos')); setDoc(r, d).catch(function (e) { falhou(e, 'guardar o pedido'); }); return r.id; }
  return id;
}
function converterPedido(id, d) {
  var cref = doc(collection(db, 'clientes'));
  var c = { nome: d.nome, telefone: d.telefone, morada: d.morada, nif: '', email: '', notas: d.descricao || '', origem: d.origem, criadoEm: serverTimestamp(), criadoPor: porQuem() };
  setDoc(cref, c).catch(function (e) { falhou(e, 'criar o cliente'); });
  clientes.push(Object.assign({ id: cref.id }, c));
  d.estado = 'Orçamentado'; d.clienteId = cref.id;
  gravarPedido(id, d);
  if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Começar um novo na mesma?')) return;
  cur = blankQuote(cref.id); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); show('novo');
  toast('Cliente criado. Preencha o orçamento.');
}

// ---------- medição ----------
function medDe(q) { if (!q.medicao) q.medicao = { fach: [], vaos: [] }; return q.medicao; }
function areaMed(m) {
  var a = 0; (m.fach || []).forEach(function (f) { a += (num(f.l) || 0) * (num(f.h) || 0); });
  (m.vaos || []).forEach(function (v) { a -= (num(v.l) || 0) * (num(v.h) || 0) * (num(v.q) || 1); });
  return Math.max(0, Math.round(a * 100) / 100);
}
function renderMed() {
  var m = medDe(cur);
  $('med-fach').innerHTML = m.fach.map(function (f, i) {
    return '<div class="medrow">' + campo('mf_n' + i, i ? '' : 'Fachada', f.n, 'text', ' data-mk="fach" data-i="' + i + '" data-c="n" placeholder="Ex.: Frente"') +
      campo('mf_l' + i, i ? '' : 'Largura (m)', f.l, 'text', ' inputmode="decimal" data-mk="fach" data-i="' + i + '" data-c="l"') +
      campo('mf_h' + i, i ? '' : 'Altura (m)', f.h, 'text', ' inputmode="decimal" data-mk="fach" data-i="' + i + '" data-c="h"') +
      '<button type="button" class="btn danger" data-mrm="fach" data-i="' + i + '" aria-label="Remover fachada">✕</button></div>';
  }).join('');
  $('med-vaos').innerHTML = m.vaos.map(function (v, i) {
    return '<div class="medrow vao">' + campo('mv_n' + i, i ? '' : 'Vão', v.n, 'text', ' data-mk="vaos" data-i="' + i + '" data-c="n" placeholder="Ex.: Janela sala"') +
      campo('mv_l' + i, i ? '' : 'Larg. (m)', v.l, 'text', ' inputmode="decimal" data-mk="vaos" data-i="' + i + '" data-c="l"') +
      campo('mv_h' + i, i ? '' : 'Alt. (m)', v.h, 'text', ' inputmode="decimal" data-mk="vaos" data-i="' + i + '" data-c="h"') +
      campo('mv_q' + i, i ? '' : 'Quant.', v.q, 'text', ' inputmode="numeric" data-mk="vaos" data-i="' + i + '" data-c="q"') +
      '<button type="button" class="btn danger" data-mrm="vaos" data-i="' + i + '" aria-label="Remover vão">✕</button></div>';
  }).join('');
  totMed();
}
function totMed() { $('med-total').textContent = fmtN(areaMed(medDe(cur))) + ' m²'; }
['med-fach', 'med-vaos'].forEach(function (id) {
  $(id).addEventListener('input', function (e) { var t = e.target; if (!t.dataset.mk) return; medDe(cur)[t.dataset.mk][+t.dataset.i][t.dataset.c] = t.value; totMed(); dirty = true; lsSet(K_DRAFT, { q: cur, dirty: true }); });
  $(id).addEventListener('click', function (e) { var t = e.target.closest('[data-mrm]'); if (!t) return; medDe(cur)[t.dataset.mrm].splice(+t.dataset.i, 1); renderMed(); dirty = true; });
});
$('b-fach').addEventListener('click', function () { medDe(cur).fach.push({ n: '', l: '', h: '' }); renderMed(); var i = cur.medicao.fach.length - 1; $('mf_n' + i).focus(); });
$('b-vao').addEventListener('click', function () { medDe(cur).vaos.push({ n: '', l: '', h: '', q: '1' }); renderMed(); var i = cur.medicao.vaos.length - 1; $('mv_n' + i).focus(); });
$('b-usar-med').addEventListener('click', function () { var a = areaMed(medDe(cur)); if (!a) { toast('Meça pelo menos uma fachada.'); return; } $('o_area').value = fmtN(a); changed(); toast('Área de ' + fmtN(a) + ' m² passada para o orçamento.'); });

// ---------- obras ----------
function obraCls(e) { return e === 'Concluída' ? 'ok' : e === 'Parada' ? 'no' : e === 'Em curso' ? 'warn' : ''; }
function progFases(o) { var f = o.fases || {}, n = FASES.filter(function (x) { return f[x[0]] && f[x[0]].f; }).length; return Math.round(n / FASES.length * 100); }
var filtroObra = 'Ativas';
function renderObras() {
  var fs = ['Ativas', 'Planeada', 'Em curso', 'Parada', 'Concluída', 'Todas'];
  $('obra-filtros').innerHTML = fs.map(function (f) { return '<button type="button" class="chip-f" data-fo="' + f + '" aria-pressed="' + (f === filtroObra) + '">' + f + '</button>'; }).join('');
  var it = obras.filter(function (o) { return filtroObra === 'Todas' || (filtroObra === 'Ativas' ? o.estado !== 'Concluída' : o.estado === filtroObra); });
  $('obras-lista').innerHTML = it.length ? it.map(obraRow).join('') : '<p class="empty">Sem obras' + (filtroObra === 'Todas' ? '' : ' neste filtro') + '. As obras criam-se a partir de um orçamento aceite ou na pasta do cliente.</p>';
}
function obraRow(o) {
  var p = progFases(o);
  return '<button type="button" class="row-i" data-obra="' + o.id + '"><span class="grow"><b>' + esc(o.nome || 'Obra') + '</b><span class="meta">' + esc([o.cliente, o.inicio ? dataPT(o.inicio) + (o.fim ? ' a ' + dataPT(o.fim) : '') : 'Sem datas'].filter(Boolean).join(' · ')) + '</span><span class="prog" style="margin-top:6px"><i style="width:' + p + '%"></i></span></span><span class="end">' + pill(o.estado || 'Planeada', obraCls(o.estado)) + '<span class="meta">' + p + ' %</span></span><span class="chev"></span></button>';
}
$('obra-filtros').addEventListener('click', function (e) { var b = e.target.closest('[data-fo]'); if (b) { filtroObra = b.dataset.fo; renderObras(); } });
$('obras-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-obra]'); if (b) abrirObra(b.dataset.obra); });
function novaObraDados(base) {
  return Object.assign({ nome: '', clienteId: null, cliente: '', morada: '', telefone: '', orcamentoId: null, orcNum: '', valor: 0, area: '', iso: '', esp: '', estado: 'Planeada', inicio: '', fim: '', equipa: [], fases: {}, notas: '', perim: '', cantos: '', criadoEm: serverTimestamp(), criadoPor: porQuem() }, base || {});
}
function criarObraDeOrc(o) {
  var ja = obras.find(function (x) { return x.orcamentoId === o.id; });
  if (ja) { abrirObra(ja.id); return; }
  var c = clientes.find(function (x) { return x.id === o.clienteId; }) || {};
  var f = o.f || {};
  var ref = doc(collection(db, 'obras'));
  var d = novaObraDados({ nome: (c.nome || o.cliente || 'Obra') + (o.morada ? ' – ' + o.morada.split(',')[0] : ''), clienteId: o.clienteId || null, cliente: c.nome || o.cliente || '', morada: o.morada || c.morada || '', telefone: c.telefone || f.c_tel || '', orcamentoId: o.id, orcNum: o.num || '', valor: o.total || 0, area: f.o_area || '', iso: f.o_iso || '', esp: f.o_esp || '' });
  setDoc(ref, d).catch(function (e) { falhou(e, 'criar a obra'); });
  obras.unshift(Object.assign({ id: ref.id }, d));
  toast('Obra criada a partir do orçamento ' + (o.num || '') + '.');
  abrirObra(ref.id);
}
function dlgNovaObra(clienteId) {
  var c = clienteId && clientes.find(function (x) { return x.id === clienteId; }) || {};
  var corpo = campo('no_nome', 'Nome da obra', c.nome ? c.nome + (c.morada ? ' – ' + c.morada.split(',')[0] : '') : '') +
    campoSel('no_cli', 'Cliente', [['', 'Sem cliente']].concat(clientes.map(function (x) { return [x.id, x.nome]; })), clienteId || '') +
    campo('no_morada', 'Morada', c.morada) +
    '<div class="grid">' + campo('no_ini', 'Início', '', 'date') + campo('no_fim', 'Fim previsto', '', 'date') + '</div>' +
    '<div class="grid">' + campo('no_valor', 'Valor acordado (€)', '', 'text', ' inputmode="decimal"') + campo('no_area', 'Área (m²)', '', 'text', ' inputmode="decimal"') + '</div>';
  abrirDlg('Nova obra', corpo, [{ txt: 'Criar obra', cls: 'acc', fn: function () {
    var nome = val('no_nome'); if (!nome) { toast('Dê um nome à obra.'); return false; }
    var cid = val('no_cli') || null, cc = cid && clientes.find(function (x) { return x.id === cid; }) || {};
    var ref = doc(collection(db, 'obras'));
    var d = novaObraDados({ nome: nome, clienteId: cid, cliente: cc.nome || '', telefone: cc.telefone || '', morada: val('no_morada') || cc.morada || '', inicio: val('no_ini'), fim: val('no_fim'), valor: num(val('no_valor')) || 0, area: val('no_area'), estado: val('no_ini') && val('no_ini') <= hoje() ? 'Em curso' : 'Planeada' });
    setDoc(ref, d).catch(function (e) { falhou(e, 'criar a obra'); });
    obras.unshift(Object.assign({ id: ref.id }, d)); abrirObra(ref.id);
  } }]);
}
$('cf-novaobra').addEventListener('click', function () { dlgNovaObra(clienteAberto); });

function fecharObra() { subsObra.forEach(function (u) { u(); }); subsObra = []; obraAberta = null; diario = []; }
var voltarObra = 'obras';
function abrirObra(id) {
  if (vistaAtual !== 'obra') voltarObra = ['cliente', 'inicio', 'orcs', 'obras', 'contas'].indexOf(vistaAtual) >= 0 ? vistaAtual : 'obras';
  fecharObra(); obraAberta = id;
  subsObra.push(onSnapshot(query(collection(db, 'obras', id, 'diario'), orderBy('data', 'desc')), function (s) { diario = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderObra(); }, function (e) { console.warn(e); }));
  renderObra(); show('obra');
}
$('ob-voltar').addEventListener('click', function () { var v = voltarObra; fecharObra(); if (v === 'cliente' && clienteAberto) show('cliente'); else show(v); });
function obraAtual() { return obras.find(function (x) { return x.id === obraAberta; }); }
function materiais(o) {
  var k = {}; K_FIELDS.forEach(function (x) { k[x] = num((config.consumos || {})[x] != null ? config.consumos[x] : K_DEF[x]); });
  var A = num(o.area) || 0, per = num(o.perim) || 0, can = num(o.cantos) || 0;
  if (!A) return null;
  var placas = A * (1 + (k.k_placa || 0) / 100), cola = A * k.k_cola, barr = A * k.k_barr, rede = A * k.k_rede, buch = Math.ceil(A * k.k_buch), prim = A * k.k_prim, acab = A * k.k_acab;
  var L = [
    ['Placas' + (o.iso ? ' ' + o.iso : '') + (o.esp ? ' ' + o.esp + ' cm' : ''), fmtN(Math.ceil(placas)) + ' m²', Math.ceil(placas / 0.5) + ' placas de 1×0,5 m'],
    ['Cola de colagem', fmtN(Math.ceil(cola)) + ' kg', k.k_saco ? Math.ceil(cola / k.k_saco) + ' sacos' : ''],
    ['Argamassa de barramento', fmtN(Math.ceil(barr)) + ' kg', k.k_saco ? Math.ceil(barr / k.k_saco) + ' sacos' : ''],
    ['Rede de fibra de vidro', fmtN(Math.ceil(rede)) + ' m²', k.k_rolo ? Math.ceil(rede / k.k_rolo) + ' rolos' : ''],
    ['Buchas', buch + ' un.', ''],
    ['Primário', fmtN(Math.ceil(prim * 10) / 10) + ' L', ''],
    ['Acabamento', fmtN(Math.ceil(acab)) + ' kg', k.k_balde ? Math.ceil(acab / k.k_balde) + ' baldes' : '']
  ];
  if (per) L.push(['Perfil de arranque', fmtN(Math.ceil(per * 1.05)) + ' m', Math.ceil(per * 1.05 / 2.5) + ' barras de 2,5 m']);
  if (can) L.push(['Cantoneiras com rede', fmtN(Math.ceil(can * 1.05)) + ' m', Math.ceil(can * 1.05 / 2.5) + ' barras de 2,5 m']);
  return L;
}
function renderObra() {
  var o = obraAtual(); if (!o) { $('obra-corpo').innerHTML = '<p class="empty">Obra não encontrada.</p>'; return; }
  if (vistaAtual === 'obra') cabecalho();
  var dsp = despesas.filter(function (d) { return d.obraId === o.id; });
  var gasto = dsp.reduce(function (a, d) { return a + (d.valor || 0); }, 0);
  var ds = dias.filter(function (d) { return d.obraId === o.id; });
  var nd = ds.reduce(function (a, d) { return a + (d.fracao || 1); }, 0);
  var recebido = todosPag.filter(function (p) { return p.clienteId === o.clienteId && o.clienteId; }).reduce(function (a, p) { return a + (p.valor || 0); }, 0);
  var f = o.fases || {}, p = progFases(o);
  var eq = o.equipa || [];
  var mat = materiais(o);
  var h = '';
  h += '<section class="card"><div class="ficha">' + avatar(o.nome, true) + '<div style="min-width:0"><h2 style="font-size:1.2rem">' + esc(o.nome || 'Obra') + '</h2><span class="meta">' + esc([o.cliente, o.morada].filter(Boolean).join(' · ')) + '</span></div></div>' +
    '<div class="row">' + telLinks(o.telefone) + mapaLink(o.morada) + (o.clienteId ? '<button type="button" class="btn ghost small" data-oa="cliente">Pasta do cliente</button>' : '') + (o.orcamentoId ? '<button type="button" class="btn ghost small" data-oa="orc">Orçamento ' + esc(o.orcNum || '') + '</button>' : '') + '</div>' +
    '<div class="grid">' + campoSel('ob_estado', 'Estado', EST_OBRA, o.estado || 'Planeada') + campo('ob_ini', 'Início', o.inicio, 'date') + campo('ob_fim', 'Fim previsto', o.fim, 'date') + '</div>' +
    '<label>Equipa nesta obra</label><div class="checks">' + pessoas().map(function (n, i) { return '<label for="eq' + i + '"><input type="checkbox" id="eq' + i + '" data-eq="' + esc(n) + '"' + (eq.indexOf(n) >= 0 ? ' checked' : '') + '>' + esc(n) + '</label>'; }).join('') + (pessoas().length ? '' : '<p class="hint">Os nomes aparecem quando a equipa criar as suas contas.</p>') + '</div></section>';
  h += '<section class="card"><h2>Contas da obra</h2><div class="kpis">' +
    '<div class="kpi"><small>Valor acordado</small><b>' + eur(o.valor) + '</b></div>' +
    '<div class="kpi"><small>Despesas</small><b>' + eur(gasto) + '</b></div>' +
    '<div class="kpi falta"><small>Resultado</small><b>' + eur((o.valor || 0) - gasto) + '</b></div></div>' +
    '<div class="facts"><span>Recebido do cliente: <strong>' + eur(recebido) + '</strong></span><span>Dias de equipa: <strong>' + fmtN(nd) + '</strong></span>' + (o.area ? '<span>Área: <strong>' + esc(o.area) + ' m²</strong></span>' : '') + '</div>' +
    '<div class="grid">' + campo('ob_valor', 'Valor acordado (€)', o.valor ? fmtN(o.valor) : '', 'text', ' inputmode="decimal"') + campo('ob_area', 'Área (m²)', o.area, 'text', ' inputmode="decimal"') + '</div></section>';
  h += '<section class="card"><div class="titulo"><h2>Fases do capoto</h2><b>' + p + ' %</b></div><div class="prog"><i style="width:' + p + '%"></i></div><div>' +
    FASES.map(function (x) { var e = f[x[0]] || {}; return '<label class="fase" for="fs_' + x[0] + '"><input type="checkbox" id="fs_' + x[0] + '" data-fase="' + x[0] + '"' + (e.f ? ' checked' : '') + '><span><span style="color:var(--fg);font-weight:600;font-size:.95rem">' + x[1] + '</span>' + (e.f ? '<small>' + dataPT(e.d) + (e.por ? ' · ' + esc(e.por) : '') + '</small>' : '') + '</span></label>'; }).join('') + '</div></section>';
  h += '<section class="card"><h2>Materiais para encomendar</h2><div class="grid">' + campo('ob_per', 'Perímetro de arranque (m)', o.perim, 'text', ' inputmode="decimal"') + campo('ob_can', 'Cantos e arestas (m)', o.cantos, 'text', ' inputmode="decimal"') + '</div>' +
    (mat ? '<div>' + mat.map(function (r) { return '<div class="mrow2"><b>' + esc(r[0]) + '</b><span class="q">' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span></div>'; }).join('') + '</div><p class="hint">Calculado com os consumos das Definições. Confirmem com a ficha técnica e o fornecedor antes de encomendar.</p><button type="button" class="btn ghost small" data-oa="partilharmat" style="align-self:flex-start">Enviar lista ao fornecedor</button>' : '<p class="hint">Indique a área da obra para calcular o material.</p>') + '</section>';
  h += '<section class="card"><h2>Diário de obra</h2><div class="grid">' + campo('dr_data', 'Dia', hoje(), 'date') + campoSel('dr_tipo', 'Tipo', TIPOS_DIA, 'Trabalho normal') + '</div>' + campoTxt('dr_txt', 'O que se fez / notas', '', 'Ex.: colagem da fachada norte; falta rede para amanhã') +
    '<button type="button" class="btn ghost small" data-oa="diario" style="align-self:flex-start">Registar no diário</button><div>' +
    (diario.length ? diario.map(function (d) { var par = /Parado|Falta/.test(d.tipo); return '<div class="aviso"><span class="dot ' + (par ? 'no' : 'info') + '"></span><span style="flex:1"><b style="font-size:.9rem">' + dataPT(d.data) + ' · ' + esc(d.tipo) + '</b><span class="meta">' + esc(d.texto || '') + (d.por ? ' — ' + esc(d.por) : '') + '</span></span><button type="button" class="btn danger small ico" data-rmdr="' + d.id + '" aria-label="Apagar registo">' + IC_DEL + '</button></div>'; }).join('') : '<p class="hint">Ainda sem registos.</p>') + '</div></section>';
  h += '<section class="card"><div class="titulo"><h2>Dias de trabalho</h2><button type="button" class="btn small" data-oa="dia">Registar</button></div>' +
    (ds.length ? '<div>' + agrupaDias(ds).slice(0, 15).map(function (g) { return '<div class="mrow2"><span style="flex:1;min-width:0"><b>' + dataPT(g.data) + '</b><span class="meta">' + esc(g.pessoas.join(', ')) + '</span></span><span class="q">' + fmtN(g.total) + (g.total === 1 ? ' dia' : ' dias') + '</span></div>'; }).join('') + '</div>' : '<p class="hint">Ainda sem dias registados.</p>') + '</section>';
  h += '<section class="card"><div class="titulo"><h2>Despesas da obra</h2><button type="button" class="btn small" data-oa="despesa">Registar</button></div>' +
    (dsp.length ? '<div>' + dsp.slice(0, 20).map(dspRow).join('') + '</div>' : '<p class="hint">Ainda sem despesas nesta obra.</p>') + '</section>';
  h += '<section class="card">' + campoTxt('ob_notas', 'Notas da obra', o.notas, 'Acessos, onde deixar material, contactos no local…') + '<div class="row"><button type="button" class="btn danger" data-oa="apagar">Apagar obra</button></div></section>';
  var foco = document.activeElement && document.activeElement.id;
  $('obra-corpo').innerHTML = h;
  if (foco && $(foco) && /^(ob_|dr_)/.test(foco)) { try { $(foco).focus(); } catch (e) {} }
}
function updObra(d) { if (!obraAberta) return; var o = obraAtual(); if (o) Object.assign(o, d); d.atualizadoEm = serverTimestamp(); updateDoc(doc(db, 'obras', obraAberta), d).catch(function (e) { falhou(e, 'guardar a obra'); }); }
$('obra-corpo').addEventListener('change', function (e) {
  var t = e.target, o = obraAtual(); if (!o) return;
  if (t.dataset.fase) { var f = Object.assign({}, o.fases || {}); f[t.dataset.fase] = t.checked ? { f: true, d: hoje(), por: porQuem() } : { f: false }; var d = { fases: f }; if (t.checked && (o.estado || 'Planeada') === 'Planeada') d.estado = 'Em curso'; updObra(d); renderObra(); return; }
  if (t.dataset.eq != null) { var eq = (o.equipa || []).filter(function (n) { return n !== t.dataset.eq; }); if (t.checked) eq.push(t.dataset.eq); updObra({ equipa: eq }); return; }
  var map = { ob_estado: 'estado', ob_ini: 'inicio', ob_fim: 'fim', ob_area: 'area', ob_per: 'perim', ob_can: 'cantos', ob_notas: 'notas' };
  if (map[t.id]) { var x = {}; x[map[t.id]] = t.value; updObra(x); if (t.id !== 'ob_notas') renderObra(); return; }
  if (t.id === 'ob_valor') { updObra({ valor: num(t.value) || 0 }); renderObra(); }
});
$('obra-corpo').addEventListener('click', function (e) {
  var b = e.target.closest('[data-oa],[data-rmdr],[data-dsp]'); if (!b) return;
  var o = obraAtual(); if (!o) return;
  if (b.dataset.rmdr) { if (confirm('Apagar este registo do diário?')) deleteDoc(doc(db, 'obras', o.id, 'diario', b.dataset.rmdr)).catch(function (er) { falhou(er, 'apagar'); }); return; }
  if (b.dataset.dsp) { dlgDespesa(b.dataset.dsp); return; }
  var a = b.dataset.oa;
  if (a === 'cliente') { abrirCliente(o.clienteId); }
  else if (a === 'orc') { var q = orcs.find(function (x) { return x.id === o.orcamentoId; }); if (q) { cur = { id: q.id, num: q.num, data: q.data, estado: q.estado, f: JSON.parse(JSON.stringify(q.f || {})), extras: JSON.parse(JSON.stringify(q.extras || [])), clienteId: q.clienteId, medicao: q.medicao ? JSON.parse(JSON.stringify(q.medicao)) : null }; dirty = false; toForm(cur); show('novo'); } }
  else if (a === 'diario') { var txt = val('dr_txt'), tipo = val('dr_tipo'); if (!txt && tipo === 'Trabalho normal') { toast('Escreva o que se fez.'); return; } setDoc(doc(collection(db, 'obras', o.id, 'diario')), { data: val('dr_data') || hoje(), tipo: tipo, texto: txt, por: porQuem(), criadoEm: serverTimestamp() }).catch(function (er) { falhou(er, 'registar no diário'); }); toast('Registado no diário.'); }
  else if (a === 'dia') dlgDia(o.id);
  else if (a === 'despesa') dlgDespesa(null, o.id);
  else if (a === 'partilharmat') { var m = materiais(o); var t = 'Material para ' + o.nome + (o.morada ? ' (' + o.morada + ')' : '') + '\n\n' + m.map(function (r) { return '• ' + r[0] + ': ' + r[1] + (r[2] ? ' (' + r[2] + ')' : ''); }).join('\n') + '\n\n' + (settings.s_nome || '') + (settings.s_resp ? ' · ' + settings.s_resp : '') + (settings.s_tel ? ' · ' + settings.s_tel : ''); if (navigator.share) navigator.share({ text: t }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('Lista copiada.'); }); }
  else if (a === 'apagar') { if (!confirm('Apagar a obra "' + o.nome + '"? As despesas e dias registados ficam, mas sem obra associada.')) return; var id = o.id; fecharObra(); show('obras'); deleteDoc(doc(db, 'obras', id)).catch(function (er) { falhou(er, 'apagar a obra'); }); toast('Obra apagada.'); }
});

// ---------- agenda ----------
function segunda(iso) { var d = new Date(iso + 'T12:00:00'), w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toISOString().slice(0, 10); }
function eventos(de, ate) {
  var ev = [];
  obras.forEach(function (o) {
    if (!o.inicio || o.estado === 'Concluída') return;
    var fim = o.fim || o.inicio; if (fim < de || o.inicio > ate) return;
    ev.push({ tipo: 'obra', ini: o.inicio, fim: fim, id: o.id, titulo: o.nome, sub: (o.equipa || []).join(', ') || 'Equipa por definir', estado: o.estado });
  });
  pedidos.forEach(function (p) { if (p.visita && p.visita >= de && p.visita <= ate && p.estado !== 'Perdido') ev.push({ tipo: 'visita', ini: p.visita, fim: p.visita, id: p.id, titulo: 'Visita: ' + p.nome, sub: (p.hora ? p.hora + ' · ' : '') + (p.morada || '') }); });
  return ev;
}
function agHTML(ev) {
  return '<button type="button" class="ag' + (ev.tipo === 'visita' ? ' visita' : '') + '" data-ev="' + ev.tipo + ':' + ev.id + '"><span class="bar"></span><span style="flex:1;min-width:0"><b style="display:block">' + esc(ev.titulo) + '</b><span class="meta">' + (!ev.ini ? '' : (ev.ini === ev.fim ? dataPT(ev.ini) : dataPT(ev.ini) + ' a ' + dataPT(ev.fim)) + ' · ') + esc(ev.sub) + '</span></span></button>';
}
function renderAgenda() {
  var de = hoje(), ate = addDias(de, 62), ev = eventos(de, ate), h = '';
  for (var w = segunda(de); w <= ate; w = addDias(w, 7)) {
    var we = addDias(w, 6), no = ev.filter(function (e) { return e.ini <= we && e.fim >= w; });
    if (!no.length) continue;
    h += '<div class="wk">Semana de ' + dataPT(w).slice(0, 5) + ' a ' + dataPT(we).slice(0, 5) + '</div>' + no.map(agHTML).join('');
  }
  var semData = obras.filter(function (o) { return !o.inicio && o.estado !== 'Concluída'; });
  if (semData.length) h += '<div class="wk">Obras sem datas</div>' + semData.map(function (o) { return agHTML({ tipo: 'obra', id: o.id, titulo: o.nome, ini: '', fim: '', sub: 'Defina as datas na obra' }); }).join('');
  $('agenda').innerHTML = h || '<p class="empty">Nada marcado nas próximas semanas. Marque datas nas obras e visitas nos pedidos.</p>';
}
function clickEv(e) { var b = e.target.closest('[data-ev]'); if (!b) return; var p = b.dataset.ev.split(':'); if (p[0] === 'obra') abrirObra(p[1]); else dlgPedido(p[1]); }
$('agenda').addEventListener('click', clickEv);

// ---------- despesas ----------
function dspRow(d) {
  return '<button type="button" class="row-i" data-dsp="' + d.id + '"><span class="grow"><b>' + esc(d.descricao || d.categoria) + '</b><span class="meta">' + dataPT(d.data) + ' · ' + esc(d.categoria) + (d.obra ? ' · ' + esc(d.obra) : '') + (d.por ? ' · ' + esc(d.por) : '') + '</span></span><span class="end"><b>' + eur(d.valor) + '</b></span></button>';
}
function renderDespesas() {
  var m = $('dsp_mes').value || mesAtual();
  var it = despesas.filter(function (d) { return (d.data || '').slice(0, 7) === m; });
  var tot = it.reduce(function (a, d) { return a + (d.valor || 0); }, 0), por = {};
  it.forEach(function (d) { por[d.categoria] = (por[d.categoria] || 0) + (d.valor || 0); });
  $('dsp-resumo').innerHTML = '<div class="total"><span>Total de ' + nomeMes(m) + '</span><b>' + eur(tot) + '</b></div>' + (Object.keys(por).length ? '<table class="tbl"><tbody>' + Object.keys(por).sort(function (a, b) { return por[b] - por[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + eur(por[k]) + '</td></tr>'; }).join('') + '</tbody></table>' : '');
  $('dsp-lista').innerHTML = it.length ? it.map(dspRow).join('') : '<p class="empty">Sem despesas em ' + nomeMes(m) + '.</p>';
}
$('dsp_mes').addEventListener('change', renderDespesas);
$('dsp-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-dsp]'); if (b) dlgDespesa(b.dataset.dsp); });
$('b-novadsp').addEventListener('click', function () { dlgDespesa(null); });
function dlgDespesa(id, obraId) {
  var d = id ? despesas.find(function (x) { return x.id === id; }) || {} : { data: hoje(), categoria: 'Combustível', obraId: obraId || '' };
  var corpo = '<div class="grid">' + campo('ds_data', 'Data', d.data, 'date') + campo('ds_valor', 'Valor (€)', d.valor ? fmtN(d.valor) : '', 'text', ' inputmode="decimal"') + '</div>' +
    campoSel('ds_cat', 'Categoria', CAT_DSP, d.categoria) + campo('ds_desc', 'Descrição', d.descricao, 'text', ' placeholder="Ex.: gasóleo carrinha, 10 sacos de cola"') + campoSel('ds_obra', 'Obra', obrasOpts(d.obraId || ''), d.obraId || '');
  var acoes = [];
  if (id) acoes.push({ txt: 'Apagar', cls: 'danger', fn: function () { if (!confirm('Apagar esta despesa?')) return false; deleteDoc(doc(db, 'despesas', id)).catch(function (e) { falhou(e, 'apagar a despesa'); }); } });
  acoes.push({ txt: 'Guardar', cls: 'acc', fn: function () {
    var v = num(val('ds_valor')); if (!v) { toast('Escreva o valor.'); $('ds_valor').focus(); return false; }
    var oid = val('ds_obra'), ob = oid && obras.find(function (x) { return x.id === oid; });
    var x = { data: val('ds_data') || hoje(), valor: v, categoria: val('ds_cat'), descricao: val('ds_desc'), obraId: oid || null, obra: ob ? ob.nome : '', atualizadoEm: serverTimestamp() };
    if (id) updateDoc(doc(db, 'despesas', id), x).catch(function (e) { falhou(e, 'guardar a despesa'); });
    else { x.por = porQuem(); x.criadoEm = serverTimestamp(); setDoc(doc(collection(db, 'despesas')), x).catch(function (e) { falhou(e, 'guardar a despesa'); }); }
    toast('Despesa guardada.');
  } });
  abrirDlg(id ? 'Despesa' : 'Nova despesa', corpo, acoes);
}

// ---------- equipa e dias ----------
function agrupaDias(lista) {
  var g = {};
  lista.forEach(function (d) { var k = d.data + '|' + (d.obraId || ''); if (!g[k]) g[k] = { data: d.data, obra: d.obra, obraId: d.obraId, pessoas: [], total: 0, ids: [] }; g[k].pessoas.push(d.pessoa + (d.fracao === 0.5 ? ' (½)' : '')); g[k].total += d.fracao || 1; g[k].ids.push(d.id); });
  return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.data.localeCompare(a.data); });
}
function renderDias() {
  var m = $('dias_mes').value || mesAtual();
  var it = dias.filter(function (d) { return (d.data || '').slice(0, 7) === m; });
  var por = {}; it.forEach(function (d) { por[d.pessoa] = (por[d.pessoa] || 0) + (d.fracao || 1); });
  $('dias-resumo').innerHTML = Object.keys(por).length ? '<table class="tbl"><thead><tr><th>Pessoa</th><th>Dias em ' + nomeMes(m) + '</th></tr></thead><tbody>' + Object.keys(por).sort().map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + fmtN(por[k]) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="hint">Sem dias registados em ' + nomeMes(m) + '.</p>';
  var g = agrupaDias(it);
  $('dias-lista').innerHTML = g.length ? g.map(function (x) { return '<div class="row-i" style="cursor:default"><span class="grow"><b>' + dataPT(x.data) + ' · ' + esc(x.obra || 'Sem obra') + '</b><span class="meta">' + esc(x.pessoas.join(', ')) + '</span></span><span class="end"><b>' + fmtN(x.total) + '</b><button type="button" class="btn danger small ico" data-rmdias="' + x.ids.join(',') + '" aria-label="Apagar registo">' + IC_DEL + '</button></span></div>'; }).join('') : '<p class="empty">Sem registos.</p>';
}
$('dias_mes').addEventListener('change', renderDias);
$('dias-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-rmdias]'); if (!b || !confirm('Apagar este registo de dias?')) return; b.dataset.rmdias.split(',').forEach(function (id) { deleteDoc(doc(db, 'dias', id)).catch(function (er) { falhou(er, 'apagar'); }); }); });
$('b-novodia').addEventListener('click', function () { dlgDia(null); });
function dlgDia(obraId) {
  var o = obraId && obras.find(function (x) { return x.id === obraId; });
  var ps = pessoas(), pre = o && o.equipa && o.equipa.length ? o.equipa : ps;
  var corpo = '<div class="grid">' + campo('dd_data', 'Dia', hoje(), 'date') + campoSel('dd_frac', 'Tempo', [['1', 'Dia inteiro'], ['0.5', 'Meio dia']], '1') + '</div>' +
    campoSel('dd_obra', 'Obra', obrasOpts(obraId || ''), obraId || '') +
    '<label>Quem trabalhou</label><div class="checks">' + ps.map(function (n, i) { return '<label for="dp' + i + '"><input type="checkbox" id="dp' + i + '" data-pess="' + esc(n) + '"' + (pre.indexOf(n) >= 0 ? ' checked' : '') + '>' + esc(n) + '</label>'; }).join('') + '</div>' +
    campo('dd_outro', 'Outra pessoa (opcional)', '', 'text', ' placeholder="Nome de um ajudante"');
  abrirDlg('Registar dia de trabalho', corpo, [{ txt: 'Registar', cls: 'acc', fn: function () {
    var quem = [].slice.call(document.querySelectorAll('[data-pess]')).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.pess; });
    if (val('dd_outro')) quem.push(val('dd_outro'));
    if (!quem.length) { toast('Escolha quem trabalhou.'); return false; }
    var oid = val('dd_obra'), ob = oid && obras.find(function (x) { return x.id === oid; }), fr = num(val('dd_frac')) || 1, dt = val('dd_data') || hoje();
    quem.forEach(function (n) { setDoc(doc(collection(db, 'dias')), { data: dt, pessoa: n, fracao: fr, obraId: oid || null, obra: ob ? ob.nome : '', por: porQuem(), criadoEm: serverTimestamp() }).catch(function (e) { falhou(e, 'registar o dia'); }); });
    if (ob && (ob.estado || 'Planeada') === 'Planeada' && dt <= hoje()) { obraAberta = obraAberta || null; updateDoc(doc(db, 'obras', ob.id), { estado: 'Em curso' }).catch(function () {}); }
    toast(quem.length + (quem.length === 1 ? ' pessoa registada.' : ' pessoas registadas.'));
  } }]);
}

// ---------- contas ----------
function renderContas() {
  var sel = $('ct_ano'), anos = {}, a0 = new Date().getFullYear();
  anos[a0] = 1; todosPag.concat(despesas).forEach(function (x) { if (x.data) anos[x.data.slice(0, 4)] = 1; });
  var lista = Object.keys(anos).sort().reverse(), v = sel.value || String(a0);
  sel.innerHTML = lista.map(function (y) { return '<option' + (y === v ? ' selected' : '') + '>' + y + '</option>'; }).join('');
  var rows = '', tR = 0, tG = 0;
  for (var m = 1; m <= 12; m++) {
    var ym = v + '-' + String(m).padStart(2, '0');
    var r = todosPag.filter(function (p) { return (p.data || '').slice(0, 7) === ym; }).reduce(function (a, p) { return a + (p.valor || 0); }, 0);
    var g = despesas.filter(function (d) { return (d.data || '').slice(0, 7) === ym; }).reduce(function (a, d) { return a + (d.valor || 0); }, 0);
    tR += r; tG += g;
    if (r || g) rows += '<tr><td>' + nomeMes(ym) + '</td><td>' + eur(r) + '</td><td>' + eur(g) + '</td><td>' + eur(r - g) + '</td></tr>';
  }
  $('ct-meses').innerHTML = '<table class="tbl"><thead><tr><th>Mês</th><th>Recebido</th><th>Gasto</th><th>Resultado</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="hint">Sem movimentos em ' + v + '.</td></tr>') + '</tbody><tfoot><tr><td><b>Total</b></td><td><b>' + eur(tR) + '</b></td><td><b>' + eur(tG) + '</b></td><td><b>' + eur(tR - tG) + '</b></td></tr></tfoot></table>';
  $('ct-obras').innerHTML = obras.length ? '<div>' + obras.map(function (o) {
    var g = despesas.filter(function (d) { return d.obraId === o.id; }).reduce(function (a, d) { return a + (d.valor || 0); }, 0);
    var nd = dias.filter(function (d) { return d.obraId === o.id; }).reduce(function (a, d) { return a + (d.fracao || 1); }, 0);
    var r = (o.valor || 0) - g;
    return '<button type="button" class="mrow2" data-obra="' + o.id + '" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer;font:inherit;color:inherit"><span style="flex:1;min-width:0"><b>' + esc(o.nome) + '</b><span class="meta">Valor ' + eur(o.valor) + ' · despesas ' + eur(g) + ' · ' + fmtN(nd) + (nd === 1 ? ' dia' : ' dias') + '</span></span><span class="q" style="color:' + (r < 0 ? 'var(--no)' : 'var(--ok)') + '">' + eur(r) + '<small>resultado</small></span></button>';
  }).join('') + '</div>' : '<p class="hint">Ainda não há obras.</p>';
}
$('ct_ano').addEventListener('change', renderContas);
$('ct-obras').addEventListener('click', function (e) { var b = e.target.closest('[data-obra]'); if (b) abrirObra(b.dataset.obra); });

// ---------- documentos ----------
function docEstado(d) {
  if (!d.validade) return ['Sem validade', ''];
  var n = diasEntre(hoje(), d.validade);
  if (n < 0) return ['Caducado', 'no'];
  if (n <= 30) return ['Caduca em ' + n + (n === 1 ? ' dia' : ' dias'), 'warn'];
  return ['Válido até ' + dataPT(d.validade), 'ok'];
}
function renderDocs() {
  var it = documentos.slice().sort(function (a, b) { return (a.validade || '9999').localeCompare(b.validade || '9999'); });
  $('docs-lista').innerHTML = it.length ? it.map(function (d) { var e = docEstado(d); return '<button type="button" class="row-i" data-doc="' + d.id + '"><span class="grow"><b>' + esc(d.nome) + '</b><span class="meta">' + esc(d.notas || '') + '</span></span><span class="end">' + pill(e[0], e[1]) + '</span><span class="chev"></span></button>'; }).join('') : '<p class="empty">Sem documentos. Adicione o seguro de acidentes de trabalho, o certificado do IMPIC e outros com validade.</p>';
}
$('docs-lista').addEventListener('click', function (e) { var b = e.target.closest('[data-doc]'); if (b) dlgDoc(b.dataset.doc); });
$('b-novodoc').addEventListener('click', function () { dlgDoc(null); });
function dlgDoc(id) {
  var d = id ? documentos.find(function (x) { return x.id === id; }) || {} : {};
  var corpo = campo('dc_nome', 'Documento', d.nome, 'text', ' list="dc-sug" placeholder="Ex.: Seguro de acidentes de trabalho"') + '<datalist id="dc-sug"><option>Seguro de acidentes de trabalho</option><option>Seguro de responsabilidade civil</option><option>Certificado de empreiteiro (IMPIC)</option><option>Inspeção da carrinha</option><option>Seguro da carrinha</option><option>Certidão de não dívida – Finanças</option><option>Certidão de não dívida – Segurança Social</option></datalist>' +
    campo('dc_val', 'Válido até', d.validade, 'date') + campoTxt('dc_notas', 'Notas', d.notas, 'Ex.: apólice n.º, seguradora, contacto');
  var acoes = [];
  if (id) acoes.push({ txt: 'Apagar', cls: 'danger', fn: function () { if (!confirm('Apagar este documento?')) return false; deleteDoc(doc(db, 'documentos', id)).catch(function (e) { falhou(e, 'apagar'); }); } });
  acoes.push({ txt: 'Guardar', cls: 'acc', fn: function () {
    var x = { nome: val('dc_nome'), validade: val('dc_val'), notas: val('dc_notas'), atualizadoEm: serverTimestamp() };
    if (!x.nome) { toast('Escreva o nome do documento.'); return false; }
    if (id) updateDoc(doc(db, 'documentos', id), x).catch(function (e) { falhou(e, 'guardar'); }); else setDoc(doc(collection(db, 'documentos')), x).catch(function (e) { falhou(e, 'guardar'); });
    toast('Documento guardado.');
  } });
  abrirDlg(id ? 'Documento' : 'Novo documento', corpo, acoes);
}

// ---------- consumos ----------
function preencherConsumos() { var c = config.consumos || {}; K_FIELDS.forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = c[k] != null ? c[k] : K_DEF[k]; }); }
$('k-guardar').addEventListener('click', function () { var c = {}; K_FIELDS.forEach(function (k) { c[k] = val(k); }); setDoc(doc(db, 'config', 'geral'), { consumos: c }, { merge: true }).catch(function (e) { falhou(e, 'guardar os consumos'); }); toast('Consumos guardados para toda a equipa.'); });

// ---------- painel ----------
function porReceberTotal() {
  var aceite = orcs.filter(function (o) { return o.estado === 'Aceite' || o.estado === 'Concluído'; }).reduce(function (a, o) { return a + (o.total || 0); }, 0);
  var pago = todosPag.reduce(function (a, p) { return a + (p.valor || 0); }, 0);
  return Math.max(aceite - pago, 0);
}
function avisos() {
  var A = [], h = hoje();
  orcs.forEach(function (o) {
    if (o.estado === 'Enviado') { var d = o.enviadoEm || o.data; if (d && diasEntre(d, h) >= 7) A.push(['warn', 'Sem resposta ao orçamento ' + o.num, (o.cliente || '') + ' · enviado há ' + diasEntre(d, h) + ' dias. Vale a pena ligar.', 'orc:' + o.id]); }
    if (o.estado === 'Aceite' && !obras.some(function (b) { return b.orcamentoId === o.id; })) A.push(['info', 'Orçamento ' + o.num + ' aceite sem obra', (o.cliente || '') + ' · toque para criar a obra.', 'criarobra:' + o.id]);
  });
  pedidos.forEach(function (p) {
    if (p.visita === h) A.push(['info', 'Visita hoje: ' + p.nome, (p.hora ? 'Às ' + p.hora + ' · ' : '') + (p.morada || ''), 'ped:' + p.id]);
    else if (p.visita === addDias(h, 1)) A.push(['info', 'Visita amanhã: ' + p.nome, (p.hora ? 'Às ' + p.hora + ' · ' : '') + (p.morada || ''), 'ped:' + p.id]);
    else if ((p.estado || 'Novo') === 'Novo' && p.data && diasEntre(p.data, h) >= 2) A.push(['warn', 'Pedido por tratar: ' + p.nome, 'Recebido há ' + diasEntre(p.data, h) + ' dias, sem visita marcada.', 'ped:' + p.id]);
  });
  obras.forEach(function (o) {
    if ((o.estado || 'Planeada') === 'Planeada' && o.inicio && o.inicio >= h && diasEntre(h, o.inicio) <= 7) A.push(['info', 'Obra começa ' + (o.inicio === h ? 'hoje' : 'a ' + dataPT(o.inicio)), o.nome + (materiais(o) ? ' · confirme o material encomendado.' : ''), 'obra:' + o.id]);
    if (o.estado === 'Em curso' && o.fim && o.fim < h) A.push(['no', 'Obra atrasada: ' + o.nome, 'Fim previsto a ' + dataPT(o.fim) + '.', 'obra:' + o.id]);
  });
  documentos.forEach(function (d) { var e = docEstado(d); if (e[1] === 'no' || e[1] === 'warn') A.push([e[1], d.nome, e[0] + '.', 'doc:' + d.id]); });
  return A;
}
function renderInicio() {
  var emCurso = obras.filter(function (o) { return o.estado === 'Em curso'; });
  var pend = orcs.filter(function (o) { return o.estado === 'Por enviar' || o.estado === 'Enviado'; });
  var mes = mesAtual(), dm = despesas.filter(function (d) { return (d.data || '').slice(0, 7) === mes; }).reduce(function (a, d) { return a + (d.valor || 0); }, 0);
  $('ini-kpis').innerHTML = '<button type="button" class="ktile dest" data-goto="contas"><small>Por receber</small><b>' + eur(porReceberTotal()) + '</b></button>' +
    '<button type="button" class="ktile" data-goto="obras"><small>Obras em curso</small><b>' + emCurso.length + '</b></button>' +
    '<button type="button" class="ktile" data-goto="orcs"><small>Orçamentos pendentes</small><b>' + pend.length + '</b></button>' +
    '<button type="button" class="ktile" data-goto="despesas"><small>Despesas de ' + nomeMes(mes).split(' ')[0] + '</small><b>' + eur(dm) + '</b></button>';
  var A = avisos();
  $('ini-avisos').innerHTML = A.length ? A.map(function (a) { return '<button type="button" class="aviso" data-av="' + a[3] + '"><span class="dot ' + a[0] + '"></span><span><b style="font-size:.92rem">' + esc(a[1]) + '</b><span class="meta">' + esc(a[2]) + '</span></span></button>'; }).join('') : '<p class="hint">Está tudo em dia.</p>';
  $('ini-obras').innerHTML = emCurso.length ? '<div class="list">' + emCurso.map(obraRow).join('') + '</div>' : '<p class="hint">Nenhuma obra em curso.</p>';
  var ev = eventos(hoje(), addDias(hoje(), 7));
  $('ini-agenda').innerHTML = ev.length ? ev.map(agHTML).join('') : '<p class="hint">Nada marcado para os próximos 7 dias.</p>';
}
$('ini-kpis').addEventListener('click', function (e) { var b = e.target.closest('[data-goto]'); if (b) show(b.dataset.goto); });
$('ini-obras').addEventListener('click', function (e) { var b = e.target.closest('[data-obra]'); if (b) abrirObra(b.dataset.obra); });
$('ini-agenda').addEventListener('click', clickEv);
$('ini-avisos').addEventListener('click', function (e) {
  var b = e.target.closest('[data-av]'); if (!b) return; var p = b.dataset.av.split(':');
  if (p[0] === 'obra') abrirObra(p[1]);
  else if (p[0] === 'ped') dlgPedido(p[1]);
  else if (p[0] === 'doc') dlgDoc(p[1]);
  else if (p[0] === 'criarobra') { var o = orcs.find(function (x) { return x.id === p[1]; }); if (o) criarObraDeOrc(o); }
  else if (p[0] === 'orc') { var q = orcs.find(function (x) { return x.id === p[1]; }); if (q && q.clienteId) abrirCliente(q.clienteId); else show('orcs'); }
});
$('ini-qa').addEventListener('click', function (e) {
  var b = e.target.closest('[data-qa]'); if (!b) return; var a = b.dataset.qa;
  if (a === 'pedido') dlgPedido(null);
  else if (a === 'orc') { if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Começar um novo na mesma?')) return; cur = blankQuote(); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); show('novo'); }
  else if (a === 'despesa') dlgDespesa(null);
  else if (a === 'dia') dlgDia(null);
});

// ---------- lista de orçamentos ----------
var filtroOrc = 'Todos';
function renderOrcs() {
  var fs = ['Todos', 'Por enviar', 'Enviado', 'Aceite', 'Recusado', 'Concluído'];
  $('orc-filtros').innerHTML = fs.map(function (f) { var n = f === 'Todos' ? orcs.length : orcs.filter(function (o) { return (o.estado || 'Por enviar') === f; }).length; return '<button type="button" class="chip-f" data-fq="' + f + '" aria-pressed="' + (f === filtroOrc) + '">' + f + ' · ' + n + '</button>'; }).join('');
  var q = ($('orc_filtro').value || '').toLowerCase();
  var it = orcs.filter(function (o) { return (filtroOrc === 'Todos' || (o.estado || 'Por enviar') === filtroOrc) && (!q || ((o.cliente || '') + ' ' + (o.morada || '') + ' ' + o.num).toLowerCase().indexOf(q) >= 0); });
  $('orc-todos').innerHTML = orcHTML(it, true);
}
$('orc-filtros').addEventListener('click', function (e) { var b = e.target.closest('[data-fq]'); if (b) { filtroOrc = b.dataset.fq; renderOrcs(); } });
$('orc_filtro').addEventListener('input', renderOrcs);
$('b-novoorc').addEventListener('click', function () { if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Começar um novo na mesma?')) return; cur = blankQuote(); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); show('novo'); });

function renderTudo() {
  renderPedidos(); renderObras(); if (vistaAtual === 'obra') renderObra();
  if (!$('oseg-agenda').hidden) renderAgenda();
  if (vistaAtual === 'despesas') renderDespesas();
  if (vistaAtual === 'dias') renderDias();
  if (vistaAtual === 'contas') renderContas();
  if (vistaAtual === 'docs') renderDocs();
  renderOrcs(); renderInicio();
  if (clienteAberto) renderObrasCliente();
}
function renderObrasCliente() {
  var it = obras.filter(function (o) { return o.clienteId === clienteAberto; });
  $('cf-obras').innerHTML = it.length ? '<div class="list">' + it.map(obraRow).join('') + '</div>' : '<p class="hint">Sem obras deste cliente.</p>';
}
$('cf-obras').addEventListener('click', function (e) { var b = e.target.closest('[data-obra]'); if (b) abrirObra(b.dataset.obra); });


$('dlg-form').addEventListener('submit', function (e) { e.preventDefault(); });

function ecran(qual) {
  $('v-login').hidden = qual !== 'login'; $('v-codigo').hidden = qual !== 'codigo'; $('app').hidden = qual !== 'app';
}
function parar() { subs.forEach(function (u) { u(); }); subs = []; fecharCliente(); fecharObra(); Object.keys(pagSubs).forEach(function (k) { pagSubs[k](); }); pagSubs = {}; pagPor = {}; }
// pagamentos de todos os clientes (para o painel e as contas)
var pagSubs = {}, pagPor = {};
function syncPagamentos() {
  var ids = {}; clientes.forEach(function (c) { ids[c.id] = 1; });
  Object.keys(pagSubs).forEach(function (k) { if (!ids[k]) { pagSubs[k](); delete pagSubs[k]; delete pagPor[k]; } });
  Object.keys(ids).forEach(function (k) {
    if (pagSubs[k]) return;
    pagSubs[k] = onSnapshot(collection(db, 'clientes', k, 'pagamentos'), function (s) {
      pagPor[k] = s.docs.map(function (d) { return Object.assign({ id: d.id, clienteId: k }, d.data()); });
      todosPag = [].concat.apply([], Object.keys(pagPor).map(function (x) { return pagPor[x]; }));
      agendarRender();
    }, function (e) { console.warn(e); });
  });
  todosPag = [].concat.apply([], Object.keys(pagPor).map(function (x) { return pagPor[x]; }));
}
var rTimer = null;
function agendarRender() { clearTimeout(rTimer); rTimer = setTimeout(function () { renderTudo(); cabecalho(); }, 30); }
function sub(nome, ordem, fn) { subs.push(onSnapshot(collection(db, nome), function (s) { fn(s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(function (x, y) { return String(y[ordem] || '').localeCompare(String(x[ordem] || '')); })); agendarRender(); }, function (e) { console.warn(e); })); }

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
    renderClientes(); renderClienteSelect(); renderCliente(); syncPagamentos(); agendarRender();
  }, function (e) { console.warn(e); }));
  subs.push(onSnapshot(query(collection(db, 'orcamentos'), orderBy('data', 'desc')), function (s) {
    orcs = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    orcs.sort(function (a, b) { return (b.data || '').localeCompare(a.data || '') || (b.num || '').localeCompare(a.num || ''); });
    renderClientes(); renderCliente(); agendarRender();
  }, function (e) { console.warn(e); }));
  sub('pedidos', 'data', function (l) { pedidos = l; });
  sub('obras', 'inicio', function (l) { obras = l.sort(function (a, b) { var o = { 'Em curso': 0, 'Parada': 1, 'Planeada': 2, 'Concluída': 3 }; return (o[a.estado] || 2) - (o[b.estado] || 2) || (a.inicio || '9').localeCompare(b.inicio || '9'); }); });
  sub('despesas', 'data', function (l) { despesas = l; });
  sub('dias', 'data', function (l) { dias = l; });
  sub('documentos', 'validade', function (l) { documentos = l; });
  recalcSettings();
  var draft = lsGet(K_DRAFT, null);
  if (draft && draft.q && draft.q.f) { cur = draft.q; if (!cur.extras) cur.extras = []; dirty = !!draft.dirty; }
  else cur = blankQuote();
  toForm(cur);
  verImport();
  show('inicio');
}

if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
$('b-pdf').addEventListener('click', function () { gerarPDF().catch(function (e) { console.error(e); toast('Não foi possível gerar o PDF.'); }); });
