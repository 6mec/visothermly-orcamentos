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
  if (vistaAtual === 'cliente') { var c = clientes.find(function (x) { return x.id === clienteAberto; }); t = clienteAberto ? 'Cliente' : 'Novo cliente'; s = 'Pasta do cliente'; }
  else if (vistaAtual === 'novo') { t = cur && cur.num ? 'Orçamento ' + cur.num : 'Novo orçamento'; s = cur && cur.f && cur.f.c_nome ? cur.f.c_nome : 'Capoto & isolamento térmico'; }
  else if (vistaAtual === 'def') { t = 'Definições'; s = 'Perfil, empresa, equipa e consumos'; }
  else if (vistaAtual === 'inicio') { var hr = new Date().getHours(); t = (hr < 13 ? 'Bom dia' : hr < 20 ? 'Boa tarde' : 'Boa noite') + (perfil.nome ? ', ' + perfil.nome.split(' ')[0] : ''); s = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }); }
  else if (vistaAtual === 'obras') { var nc = obras.filter(function (o) { return o.estado === 'Em curso'; }).length; t = 'Obras'; s = obras.length + (obras.length === 1 ? ' obra' : ' obras') + ' · ' + nc + ' em curso'; }
  else if (vistaAtual === 'obra') { var ob = obras.find(function (x) { return x.id === obraAberta; }); t = 'Obra'; s = ob ? (ob.estado || 'Planeada') + (ob.cliente ? ' · ' + ob.cliente : '') : ''; }
  else if (vistaAtual === 'orcs') { t = 'Orçamentos'; s = orcs.length + (orcs.length === 1 ? ' orçamento' : ' orçamentos'); }
  else if (vistaAtual === 'mais') { t = 'Mais'; s = 'Gestão da empresa'; }
  else if (vistaAtual === 'despesas') { t = 'Despesas'; s = 'Combustível, material e outros gastos'; }
  else if (vistaAtual === 'dias') { t = 'Equipa e dias'; s = 'Quem trabalhou, onde e quanto'; }
  else if (vistaAtual === 'contas') { t = 'Contas'; s = 'Recebido, gasto e resultado'; }
  else if (vistaAtual === 'docs') { t = 'Documentos'; s = 'Seguros, alvarás e validades'; }
  $('h-titulo').textContent = t; $('h-sub').textContent = s;
}
function show(v, dePop) {
  var de = vistaAtual;
  if (de !== v) posScroll[de] = window.scrollY;
  if (v === 'novo' && de !== 'novo') voltarNovo = de === 'obra' ? 'orcs' : de;
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
  animarVista(v, de);
  historico(v, de, dePop);
  window.scrollTo(0, (PROF[v] || 0) > (PROF[de] || 0) ? 0 : (posScroll[v] || 0));
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


// ---------- clientes ----------
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
  document.querySelectorAll('#v-cliente .so-ex').forEach(function (s) { s.hidden = !id; });
  document.querySelectorAll('#v-cliente details[data-csec]').forEach(function (d) { if (secCli[d.dataset.csec] !== undefined) d.open = !!secCli[d.dataset.csec]; });
  $('cf-dyn').innerHTML = '';
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
  if (c) { $('cf-titulo').textContent = c.nome || 'Cliente'; fichaTopo(c); cabecalho(); }
  renderObrasCliente();
  $('cf-orcs').innerHTML = orcHTML(orcs.filter(function (o) { return o.clienteId === clienteAberto; }), false);
  renderKpis();
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
      '<span>' + eur(p.valor) + ' <button type="button" class="btn ghost small" data-rec="' + p.id + '">Recibo</button><button type="button" class="btn danger small" data-rmp="' + p.id + '" aria-label="Apagar pagamento">✕</button></span></div>';
  }).join('') : '<p class="hint">Ainda não há pagamentos registados.</p>';
}
$('cf-pags').addEventListener('click', function (e) {
  if (e.target.dataset.rec) { var pp = pagamentos.find(function (x) { return x.id === e.target.dataset.rec; }); if (pp) reciboPDF(Object.assign({ clienteId: clienteAberto }, pp), clienteAberto).catch(function (er) { console.error(er); toast('Não foi possível gerar o recibo.'); }); return; }
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
  renderClienteDyn();
}
$('cf-fotos').addEventListener('click', async function (e) {
  var vf = e.target.closest('[data-verf]');
  if (vf) { e.preventDefault(); verFotoEm(vf.dataset.verf, fotos, ['clientes', clienteAberto]); return; }
  var id = e.target.dataset.rmf; if (!id) return;
  e.preventDefault();
  if (!confirm('Apagar esta fotografia?')) return;
  var f = fotos.find(function (x) { return x.id === id; });
  deleteDoc(doc(db, 'clientes', clienteAberto, 'fotosFull', id)).catch(function () {});
  deleteDoc(doc(db, 'clientes', clienteAberto, 'fotos', id)).catch(function (er) { falhou(er, 'apagar a fotografia'); });
});
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
$('f_ficheiros').addEventListener('change', async function (e) {
  var files = [].slice.call(e.target.files || []); e.target.value = '';
  if (!files.length || !clienteAberto) return;
  var est = $('f-estado');
  await enviarFotos(files, ['clientes', clienteAberto], {}, $('f_fase').value, function (t) { est.textContent = t; });
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
  $('dlg-b').oninput = null; $('dlg-b').onchange = null; $('dlg-b').onclick = null;
  var d = $('dlg'); clearTimeout(dlgT); d.classList.remove('fecha');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  if (!dlgPushed) { history.pushState({ dlg: 1 }, ''); dlgPushed = true; }
  var first = d.querySelector('.dlg-b input, .dlg-b select, .dlg-b textarea'); if (first && !('ontouchstart' in window)) first.focus();
}
var dlgT = null;
function fecharDlg(dePop) {
  var d = $('dlg'); if (!d.open) return;
  d.classList.add('fecha');
  clearTimeout(dlgT); dlgT = setTimeout(function () { d.classList.remove('fecha'); if (d.close) d.close(); else d.removeAttribute('open'); }, 150);
  if (dlgPushed && dePop !== true) { dlgPushed = false; ignorePop = true; history.back(); }
}
$('dlg-x').addEventListener('click', function () { fecharDlg(); });
$('dlg').addEventListener('cancel', function (e) { e.preventDefault(); fecharDlg(); });
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

function fecharObra() { subsObra.forEach(function (u) { u(); }); subsObra = []; obraAberta = null; diario = []; fotosObra = []; estadoFotoObra = ''; vistaFotoObra = 'todas'; }
var voltarObra = 'obras';
function abrirObra(id) {
  if (vistaAtual !== 'obra') voltarObra = ['cliente', 'inicio', 'orcs', 'obras', 'contas'].indexOf(vistaAtual) >= 0 ? vistaAtual : 'obras';
  fecharObra(); obraAberta = id;
  subsObra.push(onSnapshot(query(collection(db, 'obras', id, 'diario'), orderBy('data', 'desc')), function (s) { diario = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderObra(); }, function (e) { console.warn(e); }));
  subFotosObra(id);
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
  $('dias-lista').innerHTML = g.length ? g.map(function (x) { return '<div class="row-i" role="button" tabindex="0" data-eddias="' + x.ids.join(',') + '"><span class="grow"><b>' + dataPT(x.data) + ' · ' + esc(x.obra || 'Sem obra') + '</b><span class="meta">' + esc(x.pessoas.join(', ')) + '</span></span><span class="end"><b>' + fmtN(x.total) + '</b><button type="button" class="btn danger small ico" data-rmdias="' + x.ids.join(',') + '" aria-label="Apagar registo">' + IC_DEL + '</button></span></div>'; }).join('') : '<p class="empty">Sem registos.</p>';
}
$('dias_mes').addEventListener('change', renderDias);
$('dias-lista').addEventListener('click', function (e) { var ed = e.target.closest('[data-eddias]'); if (ed && !e.target.closest('[data-rmdias]')) { dlgEditDias(ed.dataset.eddias.split(',')); return; } var b = e.target.closest('[data-rmdias]'); if (!b || !confirm('Apagar este registo de dias?')) return; b.dataset.rmdias.split(',').forEach(function (id) { deleteDoc(doc(db, 'dias', id)).catch(function (er) { falhou(er, 'apagar'); }); }); });
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
  obras.forEach(function (o) { if (!o.clienteId) return; estadoPlano(o).forEach(function (e) { if (e.devida && e.falta > 0.005) A.push(['warn', 'Cobrar ' + eur(e.falta) + (o.cliente ? ' a ' + o.cliente : ''), (e.t.d || 'Pagamento') + ' · ' + o.nome, 'obra:' + o.id]); }); });
  documentos.forEach(function (d) { var e = docEstado(d); if (e[1] === 'no' || e[1] === 'warn') A.push([e[1], d.nome, e[0] + '.', 'doc:' + d.id]); });
  return A;
}
// ---------- lista de orçamentos ----------
var filtroOrc = 'Todos';
function renderOrcs() {
  renderOrcResumo();
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
  renderClientes();
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


// =====================================================================
// FLUIDEZ: transições, voltar do telemóvel, posição de leitura
// =====================================================================
var PROF = { inicio: 0, clientes: 0, obras: 0, orcs: 0, mais: 0, cliente: 1, novo: 1, despesas: 1, dias: 1, contas: 1, docs: 1, def: 1, obra: 2 };
var posScroll = {}, hDepth = 0, ignorePop = false, dlgPushed = false, voltarNovo = 'orcs';
var GUARD = {};
['cli-lista', 'ped-lista', 'obras-lista', 'orc-todos', 'cf-orcs', 'cf-obras', 'cf-pags', 'cf-fotos', 'ini-corpo', 'cf-dyn', 'cf-acts', 'agenda', 'dsp-lista', 'dsp-resumo', 'dias-lista', 'dias-resumo', 'ct-meses', 'ct-obras', 'docs-lista', 'obra-filtros', 'orc-filtros', 'equipa', 'obra-corpo'].forEach(function (k) { GUARD[k] = 1; });
(function () {
  // só redesenha uma lista quando o conteúdo mudou mesmo (evita piscar e imagens a recarregar)
  var d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get: d.get, set: function (v) { if (this.id && GUARD[this.id]) { if (this.__vtH === v) return; this.__vtH = v; } d.set.call(this, v); } });
})();
function animarVista(v, de) {
  if (v === de) return;
  var pa = PROF[de] || 0, pb = PROF[v] || 0, m = $('v-' + v);
  m.classList.remove('vt-a', 'vt-b', 'vt-c'); void m.offsetWidth;
  m.classList.add(pb > pa ? 'vt-a' : pb < pa ? 'vt-b' : 'vt-c');
}
function historico(v, de, dePop) {
  if (dePop || v === de) return;
  var pa = PROF[de] || 0, pb = PROF[v] || 0;
  if (pb > pa) { history.pushState({ vt: v }, ''); hDepth++; }
  else if (pb < pa && hDepth > 0) { var n = Math.min(hDepth, pa - pb); hDepth -= n; ignorePop = true; history.go(-n); }
}
function voltar() {
  var v = vistaAtual;
  if (v === 'obra') { var b = voltarObra; fecharObra(); show(b === 'cliente' && clienteAberto ? 'cliente' : b, true); }
  else if (v === 'cliente') { fecharCliente(); show('clientes', true); }
  else if (v === 'novo') show(voltarNovo === 'cliente' && !clienteAberto ? 'clientes' : voltarNovo, true);
  else if (PROF[v] === 1) show('mais', true);
}
window.addEventListener('popstate', function () {
  if (ignorePop) { ignorePop = false; return; }
  if (dlgPushed) { dlgPushed = false; fecharDlg(true); return; }
  hDepth = Math.max(0, hDepth - 1);
  voltar();
});

// =====================================================================
// PDF partilhado (recibos e relatórios)
// =====================================================================
function pdfSafe(s) { return String(s == null ? '' : s).replace(/ | /g, ' ').replace(/\t/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF€–—‘’“”•…×]/g, ''); }
function nomeFich(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, ''); }
function entregarF(blob, nome) {
  function baixar() { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000); }
  var file; try { file = new File([blob], nome, { type: blob.type }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: nome }).catch(function (e) { if (!e || e.name !== 'AbortError') baixar(); });
    return;
  }
  baixar();
}
async function pdfBase(titulo, linhasDir) {
  var L = window.PDFLib, S = settings, d = await L.PDFDocument.create();
  var reg = await d.embedFont(L.StandardFonts.Helvetica), bold = await d.embedFont(L.StandardFonts.HelveticaBold);
  var W = 595.28, H = 841.89, M = 48, CW = W - 2 * M;
  var C = { dark: L.rgb(0.169, 0.204, 0.251), blue: L.rgb(0.129, 0.357, 0.529), navy: L.rgb(0.090, 0.247, 0.373), gold: L.rgb(0.882, 0.580, 0.259), grey: L.rgb(0.35, 0.38, 0.42), line: L.rgb(0.83, 0.85, 0.87), soft: L.rgb(0.918, 0.941, 0.969), cream: L.rgb(0.984, 0.933, 0.867), white: L.rgb(1, 1, 1), light: L.rgb(0.85, 0.87, 0.9) };
  var P = { L: L, doc: d, reg: reg, bold: bold, W: W, H: H, M: M, CW: CW, C: C, page: d.addPage([W, H]), y: 0 };
  P.text = function (s, x, y, size, font, color) { P.page.drawText(pdfSafe(s), { x: x, y: y, size: size, font: font || reg, color: color || C.dark }); };
  P.width = function (s, size, font) { return (font || reg).widthOfTextAtSize(pdfSafe(s), size); };
  P.wrap = function (s, size, font, maxW) {
    var out = [];
    pdfSafe(s).split('\n').forEach(function (par) { var ws = par.split(' '), l = ''; ws.forEach(function (w) { var t = l ? l + ' ' + w : w; if (P.width(t, size, font) > maxW && l) { out.push(l); l = w; } else l = t; }); out.push(l); });
    return out;
  };
  P.need = function (h) { if (P.y - h < 70) { P.page = d.addPage([W, H]); P.y = H - M; } };
  P.para = function (s, size, font, color, x, maxW) { var lead = size * 1.45; P.wrap(s, size, font, maxW || CW - ((x || M) - M)).forEach(function (l) { P.need(lead); P.text(l, x || M, P.y, size, font, color); P.y -= lead; }); };
  P.titulo = function (t) { P.need(34); P.y -= 6; P.text(t, M, P.y, 9, bold, C.grey); P.y -= 6; P.page.drawLine({ start: { x: M, y: P.y }, end: { x: W - M, y: P.y }, thickness: 0.6, color: C.line }); P.y -= 16; };
  P.blocos = function (esq, dir) {
    var colW = CW / 2 - 10, y0 = P.y;
    function bloco(t, linhas, x) { var yy = y0; P.text(t, x, yy, 9, bold, C.grey); yy -= 15; linhas.filter(Boolean).forEach(function (l, i) { P.wrap(l, 10, i === 0 ? bold : reg, colW).forEach(function (w) { P.text(w, x, yy, 10, i === 0 ? bold : reg); yy -= 14; }); }); return yy; }
    P.y = Math.min(bloco(esq[0], esq[1], M), bloco(dir[0], dir[1], M + CW / 2 + 10)) - 10;
  };
  P.linhaValor = function (lbl, v, negrito) { P.need(20); P.text(lbl, M + 8, P.y, 10, negrito ? bold : reg); P.text(v, W - M - 8 - P.width(v, 10, negrito ? bold : reg), P.y, 10, negrito ? bold : reg); P.y -= 8; P.page.drawLine({ start: { x: M, y: P.y }, end: { x: W - M, y: P.y }, thickness: 0.5, color: C.line }); P.y -= 14; };
  // cabeçalho
  P.page.drawRectangle({ x: 0, y: H - 100, width: W, height: 100, color: C.blue });
  P.page.drawRectangle({ x: 0, y: H - 104, width: W, height: 4, color: C.gold });
  var tx = M;
  try { var png = await d.embedPng(await (await fetch('logo-icone.png')).arrayBuffer()); P.page.drawRectangle({ x: M, y: H - 84, width: 64, height: 64, color: C.white }); P.page.drawImage(png, { x: M + 4, y: H - 80, width: 56, height: 56 }); tx = M + 78; } catch (e) {}
  P.text(S.s_nome || 'VisoThermLy', tx, H - 52, 22, bold, C.white);
  P.text('Capoto & isolamento térmico', tx, H - 72, 10, reg, C.light);
  P.text(titulo, W - M - P.width(titulo, 12, bold), H - 48, 12, bold, C.white);
  (linhasDir || []).forEach(function (l, i) { P.text(l, W - M - P.width(l, 10), H - 64 - i * 14, 10, reg, C.light); });
  P.y = H - 135;
  P.fim = async function (nome) {
    var pages = d.getPages();
    pages.forEach(function (p, i) {
      var ft = (S.s_nome || '') + (S.s_tel ? ' · ' + S.s_tel : '') + (S.s_email ? ' · ' + S.s_email : '');
      p.drawText(pdfSafe(ft), { x: M, y: 28, size: 8, font: reg, color: C.grey });
      var pg = 'Página ' + (i + 1) + ' de ' + pages.length;
      p.drawText(pg, { x: W - M - reg.widthOfTextAtSize(pg, 8), y: 28, size: 8, font: reg, color: C.grey });
    });
    var bytes = await d.save();
    entregarF(new Blob([bytes], { type: 'application/pdf' }), nome);
  };
  return P;
}
function empresaLinhas() { var S = settings; return [S.s_nome || 'VisoThermLy', S.s_resp, S.s_tel && 'Tel.: ' + S.s_tel, S.s_email, S.s_nif && 'NIF: ' + S.s_nif, S.s_morada]; }

// valor por extenso (euros)
function extenso(v) {
  var u = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
  var dz = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  var ct = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(n) { if (n === 100) return 'cem'; var p = []; if (n >= 100) { p.push(ct[Math.floor(n / 100)]); n %= 100; } if (n >= 20) p.push(dz[Math.floor(n / 10)] + (n % 10 ? ' e ' + u[n % 10] : '')); else if (n > 0) p.push(u[n]); return p.join(' e '); }
  function inteiro(n) {
    if (!n) return 'zero';
    var mi = Math.floor(n / 1e6), mil = Math.floor(n % 1e6 / 1000), r = n % 1000, p = [];
    if (mi) p.push(mi === 1 ? 'um milhão' : ate999(mi) + ' milhões');
    if (mil) p.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
    if (r) p.push(ate999(r));
    if (p.length > 1 && r && (r < 100 || r % 100 === 0)) { var last = p.pop(); return p.join(' ') + ' e ' + last; }
    return p.join(' ');
  }
  v = Math.round((v || 0) * 100) / 100;
  var e = Math.floor(v), c = Math.round((v - e) * 100), s = '';
  if (e) s = inteiro(e) + (e === 1 ? ' euro' : (e % 1e6 === 0 ? ' de euros' : ' euros'));
  if (c) s += (s ? ' e ' : '') + inteiro(c) + (c === 1 ? ' cêntimo' : ' cêntimos');
  return s || 'zero euros';
}

// =====================================================================
// PAGAMENTOS POR FASES
// =====================================================================
function pagsObra(o) {
  if (!o || !o.clienteId) return [];
  var unica = obras.filter(function (x) { return x.clienteId === o.clienteId; }).length === 1;
  return todosPag.filter(function (p) { return p.clienteId === o.clienteId && (p.obraId === o.id || (!p.obraId && unica)); }).sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
}
function recebidoObra(o) { return pagsObra(o).reduce(function (a, p) { return a + (p.valor || 0); }, 0); }
function quandoOpts() { return [['inicio', 'No início da obra']].concat(FASES.map(function (f) { return [f[0], 'Ao concluir: ' + f[1].toLowerCase()]; })).concat([['fim', 'No fim da obra'], ['data', 'Numa data']]); }
function quandoTxt(t) { if (t.q === 'data') return t.data ? 'A ' + dataPT(t.data) : 'Data por definir'; var x = quandoOpts().find(function (k) { return k[0] === t.q; }); return x ? x[1] : ''; }
function trancheDevida(t, o) {
  var f = o.fases || {};
  if (t.q === 'inicio') return (o.estado && o.estado !== 'Planeada') || !!(o.inicio && o.inicio <= hoje());
  if (t.q === 'fim') return o.estado === 'Concluída' || !!(f.remates && f.remates.f);
  if (t.q === 'data') return !!t.data && t.data <= hoje();
  return !!(f[t.q] && f[t.q].f);
}
function estadoPlano(o) {
  var rest = recebidoObra(o);
  return (o.plano || []).map(function (t) { var v = t.v || 0, pago = Math.max(0, Math.min(v, rest)); rest -= v; return { t: t, pago: pago, falta: Math.round((v - pago) * 100) / 100, devida: trancheDevida(t, o) }; });
}
function pagamentosObraHTML(o) {
  var rec = recebidoObra(o), falta = Math.max((o.valor || 0) - rec, 0), ps = pagsObra(o), ep = estadoPlano(o);
  var h = '<section class="card"><div class="titulo"><h2>Pagamentos do cliente</h2>' + (o.clienteId ? '<button type="button" class="btn small" data-oa="pagar">Registar</button>' : '') + '</div>';
  if (!o.clienteId) return h + '<p class="hint">Esta obra não tem cliente associado. Os pagamentos registam-se na pasta do cliente.</p></section>';
  h += '<div class="kpis"><div class="kpi"><small>Acordado</small><b>' + eur(o.valor) + '</b></div><div class="kpi"><small>Recebido</small><b>' + eur(rec) + '</b></div><div class="kpi falta"><small>Falta</small><b>' + eur(falta) + '</b></div></div>';
  if (ep.length) {
    var soma = (o.plano || []).reduce(function (a, t) { return a + (t.v || 0); }, 0);
    h += '<div>' + ep.map(function (e) {
      var st = e.falta <= 0.005 ? pill('Pago', 'ok') : e.devida ? pill('Cobrar ' + eur(e.falta), 'warn') : e.pago > 0 ? pill('Falta ' + eur(e.falta)) : pill('Por cobrar');
      return '<div class="mrow2"><span style="flex:1;min-width:0"><b>' + esc(e.t.d || 'Pagamento') + ' · ' + eur(e.t.v) + '</b><span class="meta">' + esc(quandoTxt(e.t)) + '</span></span><span class="q">' + st + '</span></div>';
    }).join('') + '</div>';
    if (o.valor && Math.abs(soma - o.valor) > 0.01) h += '<p class="hint">O plano soma ' + eur(soma) + ' e o valor acordado é ' + eur(o.valor) + '.</p>';
  } else h += '<p class="hint">Defina em que momentos o cliente paga (por exemplo, uma parte na adjudicação, outra a meio e o resto no fim). A app avisa quando chega a altura de cobrar.</p>';
  h += '<button type="button" class="btn ghost small" data-oa="plano" style="align-self:flex-start">' + (ep.length ? 'Alterar plano de pagamentos' : 'Definir plano de pagamentos') + '</button>';
  if (ps.length) h += '<div>' + ps.slice().reverse().map(function (p) { return '<div class="mrow2"><span style="flex:1;min-width:0"><b>' + eur(p.valor) + '</b><span class="meta">' + dataPT(p.data) + (p.descricao ? ' · ' + esc(p.descricao) : '') + '</span></span><button type="button" class="btn ghost small" data-recp="' + p.id + '">Recibo</button></div>'; }).join('') + '</div>';
  return h + '</section>';
}
function dlgPlano(o) {
  var pl = JSON.parse(JSON.stringify(o.plano || []));
  function linha(t, i) {
    return '<div class="card" style="padding:12px;gap:8px;box-shadow:none;border:1px solid var(--line)"><div class="grid">' +
      campo('pl_d' + i, 'Descrição', t.d, 'text', ' data-pl="' + i + '" data-c="d"') + campo('pl_v' + i, 'Valor (€)', t.v ? fmtN(t.v) : '', 'text', ' inputmode="decimal" data-pl="' + i + '" data-c="v"') + '</div>' +
      '<div class="grid">' + '<label for="pl_q' + i + '">Quando<select id="pl_q' + i + '" data-pl="' + i + '" data-c="q">' + opts(quandoOpts(), t.q || 'inicio') + '</select></label>' +
      (t.q === 'data' ? campo('pl_dt' + i, 'Data', t.data, 'date', ' data-pl="' + i + '" data-c="data"') : '') + '</div>' +
      '<button type="button" class="btn danger small" data-plrm="' + i + '" style="align-self:flex-start">Remover</button></div>';
  }
  function soma() { var s = pl.reduce(function (a, t) { return a + (num(t.v) || 0); }, 0); return 'Total do plano: ' + eur(s) + (o.valor ? ' · valor acordado: ' + eur(o.valor) : ''); }
  function desenhar() { $('pl-rows').innerHTML = pl.map(linha).join('') || '<p class="hint">Sem parcelas. Escolha um modelo ou adicione uma parcela.</p>'; $('pl-soma').textContent = soma(); }
  var corpo = '<p class="hint">Modelos rápidos (calculados a partir do valor acordado, depois pode alterar):</p><div class="row"><button type="button" class="btn ghost small" data-pltpl="304030">30 / 40 / 30</button><button type="button" class="btn ghost small" data-pltpl="5050">50 / 50</button><button type="button" class="btn ghost small" data-pltpl="100">Tudo no fim</button></div><div id="pl-rows" style="display:flex;flex-direction:column;gap:10px"></div><button type="button" class="btn ghost small" id="pl-add" style="align-self:flex-start">+ Adicionar parcela</button><p class="hint" id="pl-soma"></p>';
  abrirDlg('Plano de pagamentos', corpo, [{ txt: 'Guardar plano', cls: 'acc', fn: function () {
    var limpo = pl.map(function (t) { return { d: (t.d || '').trim() || 'Pagamento', v: Math.round((num(t.v) || 0) * 100) / 100, q: t.q || 'inicio', data: t.q === 'data' ? (t.data || '') : '' }; }).filter(function (t) { return t.v > 0; });
    updObra({ plano: limpo }); renderObra(); toast('Plano de pagamentos guardado.');
  } }]);
  desenhar();
  $('dlg-b').oninput = function (e) { var t = e.target; if (t.dataset.pl == null) return; pl[+t.dataset.pl][t.dataset.c] = t.value; $('pl-soma').textContent = soma(); };
  $('dlg-b').onchange = function (e) { var t = e.target; if (t.dataset.c === 'q') { pl[+t.dataset.pl].q = t.value; desenhar(); } };
  $('dlg-b').onclick = function (e) {
    var b = e.target.closest('[data-pltpl],[data-plrm],#pl-add'); if (!b) return;
    if (b.id === 'pl-add') { pl.push({ d: '', v: '', q: 'fim' }); desenhar(); return; }
    if (b.dataset.plrm != null) { pl.splice(+b.dataset.plrm, 1); desenhar(); return; }
    var V = o.valor || 0; if (!V) { toast('Indique primeiro o valor acordado da obra.'); return; }
    var mod = { '304030': [['Adjudicação', 0.3, 'inicio'], ['A meio da obra', 0.4, 'barramento'], ['Final da obra', 0.3, 'fim']], '5050': [['Início da obra', 0.5, 'inicio'], ['Final da obra', 0.5, 'fim']], '100': [['Pagamento final', 1, 'fim']] }[b.dataset.pltpl];
    var acc = 0;
    pl = mod.map(function (m, i) { var v = i === mod.length - 1 ? Math.round((V - acc) * 100) / 100 : Math.round(V * m[1] * 100) / 100; acc += v; return { d: m[0], v: fmtN(v), q: m[2] }; });
    desenhar();
  };
}
function dlgPagarObra(o) {
  var prox = estadoPlano(o).find(function (e) { return e.falta > 0.005; });
  var corpo = '<div class="grid">' + campo('po_data', 'Data', hoje(), 'date') + campo('po_valor', 'Valor (€)', prox ? fmtN(prox.falta) : '', 'text', ' inputmode="decimal"') + '</div>' + campo('po_desc', 'Descrição', prox ? prox.t.d : '', 'text', ' placeholder="Ex.: adjudicação, transferência"');
  function gravar() {
    var v = num(val('po_valor')); if (!v) { toast('Escreva o valor.'); return null; }
    var ref = doc(collection(db, 'clientes', o.clienteId, 'pagamentos'));
    var p = { data: val('po_data') || hoje(), valor: v, descricao: val('po_desc'), obraId: o.id, por: porQuem(), criadoEm: serverTimestamp() };
    setDoc(ref, p).catch(function (e) { falhou(e, 'registar o pagamento'); });
    toast('Pagamento de ' + eur(v) + ' registado.');
    return Object.assign({ id: ref.id, clienteId: o.clienteId }, p);
  }
  abrirDlg('Registar pagamento', corpo, [
    { txt: 'Guardar e fazer recibo', cls: 'ghost', fn: function () { var p = gravar(); if (!p) return false; reciboPDF(p, o.clienteId).catch(function (e) { console.error(e); toast('Não foi possível gerar o recibo.'); }); } },
    { txt: 'Guardar', cls: 'acc', fn: function () { if (!gravar()) return false; } }
  ]);
}

// =====================================================================
// RECIBO (comprovativo de pagamento)
// =====================================================================
async function reciboPDF(p, clienteId) {
  var c = clientes.find(function (x) { return x.id === clienteId; }) || {};
  var o = p.obraId && obras.find(function (x) { return x.id === p.obraId; });
  if (!o) { var os = obras.filter(function (x) { return x.clienteId === clienteId; }); if (os.length === 1) o = os[0]; }
  var numero = 'CP-' + (p.data || hoje()).replace(/-/g, '') + '-' + String(p.id || '').slice(0, 4).toUpperCase();
  var P = await pdfBase('COMPROVATIVO DE PAGAMENTO', ['N.º ' + numero, 'Data: ' + dataPT(p.data || hoje())]);
  var C = P.C;
  P.blocos(['RECEBIDO DE', [c.nome || '—', c.nif && 'NIF: ' + c.nif, c.morada, c.telefone && 'Tel.: ' + c.telefone]], ['EMITIDO POR', empresaLinhas()]);
  P.y -= 6;
  // caixa com o valor
  var bx = 74; P.need(bx + 10);
  P.page.drawRectangle({ x: P.M, y: P.y - bx + 14, width: P.CW, height: bx, color: C.cream });
  P.text('Recebemos a quantia de', P.M + 16, P.y - 4, 10, P.reg, C.grey);
  var vv = eur(p.valor); P.text(vv, P.M + 16, P.y - 30, 22, P.bold, C.navy);
  P.y -= 46;
  P.para('(' + extenso(p.valor) + ')', 10, P.reg, C.dark, P.M + 16, P.CW - 32);
  P.y -= 18;
  P.titulo('REFERENTE A');
  P.para((p.descricao || 'Pagamento') + (o ? ' — ' + (o.morada ? 'obra em ' + o.morada : 'obra ' + o.nome) : ''), 10.5, P.reg);
  if (o && o.valor) {
    P.y -= 4; P.titulo('SITUAÇÃO DA OBRA A ' + dataPT(hoje()));
    var rec = recebidoObra(o); if (!todosPag.some(function (x) { return x.id === p.id; })) rec += p.valor || 0;
    P.linhaValor('Valor acordado', eur(o.valor));
    P.linhaValor('Total recebido', eur(rec));
    P.linhaValor('Em falta', eur(Math.max(o.valor - rec, 0)), true);
  }
  P.need(90); P.y -= 40;
  P.page.drawLine({ start: { x: P.M, y: P.y }, end: { x: P.M + 230, y: P.y }, thickness: 0.6, color: C.grey });
  P.text('Recebido por' + (porQuem() ? ' ' + porQuem() : ''), P.M, P.y - 12, 8.5, P.reg, C.grey);
  P.y -= 40;
  P.para('Documento interno de comprovativo de pagamento. Não substitui a fatura ou fatura-recibo emitida no Portal das Finanças.', 8.5, P.reg, C.grey);
  await P.fim('Comprovativo_' + numero + (c.nome ? '_' + nomeFich(c.nome) : '') + '.pdf');
}

// =====================================================================
// FOTOGRAFIAS (partilhado entre pasta do cliente e obra)
// =====================================================================
var FASES_FOTO = ['Visita', 'Antes', 'Durante', 'Depois', 'Problema'];
var fotosObra = [], faseFotoObra = 'Durante', vistaFotoObra = 'todas', estadoFotoObra = '';
function tsN(x) { if (!x) return 1e15; if (x.seconds) return x.seconds; var t = Date.parse(x); return isNaN(t) ? 0 : t / 1000; }
function baseFotosObra(o) { return o.clienteId ? ['clientes', o.clienteId] : ['obras', o.id]; }
async function enviarFotos(files, base, extra, fase, est) {
  var n = files.length;
  for (var i = 0; i < n; i++) {
    est('A preparar fotografia ' + (i + 1) + ' de ' + n + '…');
    try {
      var img = await abrirImg(files[i]);
      var full = await imgData(img, 1280, 0.72, 700000);
      var thumb = await imgData(img, 360, 0.7, 60000);
      var fref = doc(collection(db, base[0], base[1], 'fotos'));
      setDoc(doc(db, base[0], base[1], 'fotosFull', fref.id), { img: full }).catch(function (e) { falhou(e, 'enviar a fotografia'); });
      setDoc(fref, Object.assign({ thumb: thumb, fase: fase, por: porQuem(), criadoEm: serverTimestamp() }, extra || {})).catch(function (e) { falhou(e, 'enviar a fotografia'); });
    } catch (er) { console.error(er); est('Não foi possível abrir a fotografia. Tente outra.'); return; }
  }
  est((n === 1 ? 'Fotografia guardada' : n + ' fotografias guardadas') + (navigator.onLine ? '.' : '. Seguem para a equipa quando houver internet.'));
}
async function verFotoEm(id, lista, base) {
  var f = lista.find(function (x) { return x.id === id; }); if (!f) return;
  abrirDlg((f.fase || 'Fotografia') + (f.por ? ' · ' + f.por : ''), '<img src="' + esc(f.thumb || f.url || '') + '" alt="Fotografia" style="width:100%;border-radius:12px;display:block;filter:blur(2px)">', []);
  var src = f.url || '';
  try { var d = await getDoc(doc(db, base[0], base[1], 'fotosFull', id)); if (d.exists() && d.data().img) src = d.data().img; } catch (e) { console.warn(e); }
  if (!src) src = f.thumb || '';
  var dt = f.criadoEm && f.criadoEm.toDate ? f.criadoEm.toDate().toLocaleString('pt-PT') : '';
  $('dlg-b').innerHTML = '<img src="' + esc(src) + '" alt="Fotografia" style="width:100%;border-radius:12px;display:block">' + (dt ? '<p class="hint">' + esc(dt) + '</p>' : '');
}
function fotoCel(f, ver, rm) { return '<div class="foto"><a href="#" ' + ver + '="' + f.id + '"><img src="' + esc(f.thumb || f.url || '') + '" alt="Fotografia ' + esc(f.fase || '') + '" loading="lazy" style="pointer-events:none"></a><span>' + esc(f.fase || '') + '</span><button type="button" ' + rm + '="' + f.id + '" aria-label="Apagar fotografia">✕</button></div>'; }
var IC_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
function fotosObraHTML(o) {
  var h = '<section class="card"><div class="titulo"><h2>Fotografias</h2><span class="meta">' + fotosObra.length + '</span></div>' +
    '<div class="row" style="align-items:flex-end">' + '<label for="of_fase" style="flex:1 1 120px">Fase<select id="of_fase">' + opts(FASES_FOTO, faseFotoObra) + '</select></label>' +
    '<label class="btn" for="of_cam" style="color:#fff">' + IC_CAM + 'Tirar<input id="of_cam" type="file" accept="image/*" capture="environment" hidden></label>' +
    '<label class="btn ghost" for="of_gal">Galeria<input id="of_gal" type="file" accept="image/*" multiple hidden></label></div>' +
    '<p class="hint" id="of-estado"' + (estadoFotoObra ? '' : ' hidden') + '>' + esc(estadoFotoObra) + '</p>';
  if (!fotosObra.length) return h + '<p class="hint">Ainda sem fotografias desta obra. Tirem fotos antes de começar e no fim: ficam no relatório para o cliente.</p></section>';
  h += '<div class="seg"><button type="button" data-fv="todas" aria-selected="' + (vistaFotoObra === 'todas') + '">Todas</button><button type="button" data-fv="ad" aria-selected="' + (vistaFotoObra === 'ad') + '">Antes e depois</button></div>';
  if (vistaFotoObra === 'ad') {
    var an = fotosObra.filter(function (f) { return f.fase === 'Antes' || f.fase === 'Visita'; }), de = fotosObra.filter(function (f) { return f.fase === 'Depois'; });
    h += '<div class="ad"><div><b>Antes</b><div class="fotos">' + (an.map(function (f) { return fotoCel(f, 'data-verfo', 'data-rmfo'); }).join('') || '<p class="hint">Sem fotos.</p>') + '</div></div><div><b>Depois</b><div class="fotos">' + (de.map(function (f) { return fotoCel(f, 'data-verfo', 'data-rmfo'); }).join('') || '<p class="hint">Sem fotos.</p>') + '</div></div></div>';
  } else h += '<div class="fotos">' + fotosObra.map(function (f) { return fotoCel(f, 'data-verfo', 'data-rmfo'); }).join('') + '</div>';
  return h + '</section>';
}
function subFotosObra(id) {
  var o = obras.find(function (x) { return x.id === id; }); if (!o) return;
  var b = baseFotosObra(o);
  subsObra.push(onSnapshot(collection(db, b[0], b[1], 'fotos'), function (s) {
    fotosObra = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (f) { return b[0] === 'obras' || f.obraId === id; }).sort(function (x, y) { return tsN(y.criadoEm) - tsN(x.criadoEm); });
    renderObra();
  }, function (e) { console.warn(e); }));
}
$('obra-corpo').addEventListener('change', function (e) {
  var t = e.target, o = obraAtual(); if (!o) return;
  if (t.id === 'of_fase') { faseFotoObra = t.value; return; }
  if (t.id === 'of_cam' || t.id === 'of_gal') {
    var files = [].slice.call(t.files || []); t.value = ''; if (!files.length) return;
    enviarFotos(files, baseFotosObra(o), { obraId: o.id }, faseFotoObra, function (s) { estadoFotoObra = s; var el = $('of-estado'); if (el) { el.hidden = false; el.textContent = s; } });
  }
});
$('obra-corpo').addEventListener('click', function (e) {
  var o = obraAtual(); if (!o) return;
  var b = e.target.closest('[data-verfo],[data-rmfo],[data-fv],[data-recp],[data-oa="pagar"],[data-oa="plano"],[data-oa="relatorio"]'); if (!b) return;
  e.preventDefault();
  if (b.dataset.verfo) verFotoEm(b.dataset.verfo, fotosObra, baseFotosObra(o));
  else if (b.dataset.rmfo) { if (!confirm('Apagar esta fotografia?')) return; var bs = baseFotosObra(o); deleteDoc(doc(db, bs[0], bs[1], 'fotosFull', b.dataset.rmfo)).catch(function () {}); deleteDoc(doc(db, bs[0], bs[1], 'fotos', b.dataset.rmfo)).catch(function (er) { falhou(er, 'apagar a fotografia'); }); }
  else if (b.dataset.fv) { vistaFotoObra = b.dataset.fv; renderObra(); }
  else if (b.dataset.recp) { var p = todosPag.find(function (x) { return x.id === b.dataset.recp; }); if (p) reciboPDF(p, p.clienteId).catch(function (er) { console.error(er); toast('Não foi possível gerar o recibo.'); }); }
  else if (b.dataset.oa === 'pagar') dlgPagarObra(o);
  else if (b.dataset.oa === 'plano') dlgPlano(o);
  else if (b.dataset.oa === 'relatorio') dlgRelatorio(o);
});

// =====================================================================
// RELATÓRIO FINAL DA OBRA
// =====================================================================
function dlgRelatorio(o) {
  var na = fotosObra.filter(function (f) { return f.fase === 'Antes' || f.fase === 'Visita'; }).length, nd = fotosObra.filter(function (f) { return f.fase === 'Depois'; }).length;
  var corpo = '<p class="hint">PDF para entregar ao cliente com o resumo da obra, as fases concluídas e as fotografias de antes e depois.</p>' +
    campoTxt('rf_msg', 'Mensagem para o cliente (opcional)', '', 'Ex.: Obrigado pela confiança. Qualquer questão, estamos ao dispor.') +
    '<div class="checks"><label for="rf_fotos"><input type="checkbox" id="rf_fotos"' + (na || nd ? ' checked' : '') + '>Incluir fotografias (' + na + ' antes, ' + nd + ' depois)</label></div>';
  abrirDlg('Relatório final', corpo, [{ txt: 'Gerar PDF', cls: 'acc', fn: async function () {
    var msg = val('rf_msg'), cf = $('rf_fotos').checked;
    toast('A preparar o relatório…');
    try { await relatorioPDF(o, msg, cf); } catch (e) { console.error(e); toast('Não foi possível gerar o relatório.'); }
  } }]);
}
async function relatorioPDF(o, msg, comFotos) {
  var c = clientes.find(function (x) { return x.id === o.clienteId; }) || {};
  var f = o.fases || {};
  var feitas = FASES.filter(function (x) { return f[x[0]] && f[x[0]].f; });
  var ultima = feitas.reduce(function (a, x) { return f[x[0]].d && f[x[0]].d > a ? f[x[0]].d : a; }, '');
  var P = await pdfBase('RELATÓRIO DE OBRA', ['Data: ' + dataPT(hoje())]);
  var C = P.C;
  P.blocos(['CLIENTE', [o.cliente || c.nome || '—', (c.telefone || o.telefone) && 'Tel.: ' + (c.telefone || o.telefone), o.morada && 'Obra: ' + o.morada]], ['EMPRESA', empresaLinhas()]);
  P.titulo('RESUMO DA OBRA');
  var res = [];
  if (o.inicio) res.push(['Início', dataPT(o.inicio)]);
  if (o.estado === 'Concluída' || ultima) res.push([o.estado === 'Concluída' ? 'Conclusão' : 'Último trabalho registado', dataPT(ultima || o.fim)]);
  if (o.area) res.push(['Área de fachada', String(o.area).replace('.', ',') + ' m²']);
  if (o.iso || o.esp) res.push(['Isolamento', [o.iso, o.esp ? o.esp + ' cm' : ''].filter(Boolean).join(' · ')]);
  res.push(['Estado', o.estado || 'Planeada']);
  res.forEach(function (r) { P.linhaValor(r[0], r[1]); });
  P.titulo('TRABALHOS REALIZADOS');
  if (feitas.length) feitas.forEach(function (x) { var e = f[x[0]]; P.need(18); P.text('•', P.M + 4, P.y, 10, P.bold, C.gold); P.text(x[1], P.M + 16, P.y, 10.5, P.reg); if (e.d) { var dd = dataPT(e.d); P.text(dd, P.W - P.M - P.width(dd, 9.5), P.y, 9.5, P.reg, C.grey); } P.y -= 18; });
  else P.para('Ainda não há fases marcadas como concluídas.', 10, P.reg, C.grey);
  if (msg) { P.titulo('NOTA'); P.para(msg, 10.5, P.reg); }
  if (comFotos) {
    var base = baseFotosObra(o);
    async function grupo(titulo, lista) {
      if (!lista.length) return;
      var cw = (P.CW - 12) / 2, chH = cw * 0.75;
      P.need(chH + 50); P.titulo(titulo);
      for (var i = 0; i < lista.length; i += 2) {
        P.need(chH + 12);
        for (var k = 0; k < 2 && i + k < lista.length; k++) {
          var ft = lista[i + k], src = ft.thumb || '';
          try { var d = await getDoc(doc(db, base[0], base[1], 'fotosFull', ft.id)); if (d.exists() && d.data().img) src = d.data().img; } catch (e) {}
          if (!src) continue;
          try {
            var im = await P.doc.embedJpg(await (await fetch(src)).arrayBuffer());
            var sc = Math.min(cw / im.width, chH / im.height), w = im.width * sc, hh = im.height * sc, x = P.M + k * (cw + 12);
            P.page.drawRectangle({ x: x, y: P.y - chH, width: cw, height: chH, color: C.soft });
            P.page.drawImage(im, { x: x + (cw - w) / 2, y: P.y - chH + (chH - hh) / 2, width: w, height: hh });
          } catch (e) { console.warn(e); }
        }
        P.y -= chH + 12;
      }
    }
    var ord = function (a, b) { return tsN(a.criadoEm) - tsN(b.criadoEm); };
    await grupo('ANTES', fotosObra.filter(function (x) { return x.fase === 'Antes' || x.fase === 'Visita'; }).sort(ord).slice(0, 6));
    await grupo('DEPOIS', fotosObra.filter(function (x) { return x.fase === 'Depois'; }).sort(ord).slice(0, 6));
  }
  await P.fim('Relatorio_obra_' + nomeFich(o.nome || 'obra') + '.pdf');
}

// =====================================================================
// PÁGINA DA OBRA (painel dinâmico)
// =====================================================================
var secAbertas = { pag: false, fases: true, fotos: false, mat: false, diario: false, dias: false, dsp: false, det: false };
var SV = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
var ICO = {
  tel: SV('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  wa: SV('<path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.3L3 20.5l1.8-5.3A8.4 8.4 0 1 1 21 11.5z"/>'),
  mapa: SV('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  cli: SV('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  doc: SV('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  eur: SV('<path d="M18 7a7 7 0 1 0 0 10M4 10h9M4 14h9"/>'),
  fases: SV('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  cam: SV('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  caixa: SV('<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>'),
  livro: SV('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M20 17v5H6.5A2.5 2.5 0 0 1 4 19.5"/>'),
  equipa: SV('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  recibo: SV('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  ajustes: SV('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  cal: SV('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  flag: SV('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>'),
  mais: SV('<path d="M12 5v14M5 12h14"/>')
};
function anel(p) { var c = 2 * Math.PI * 30; return '<svg class="anel" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30" class="a-bg"/><circle cx="36" cy="36" r="30" class="a-fg" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p / 100)).toFixed(1) + '"/></svg><b>' + p + '%</b>'; }
function sec(id, ic, titulo, resumo, corpo, tom) {
  return '<details class="sec" data-sec="' + id + '"' + (secAbertas[id] ? ' open' : '') + '><summary><span class="sec-ic">' + ic + '</span><span class="sec-t"><b>' + titulo + '</b><span class="meta">' + resumo + '</span></span>' + (tom ? pill(tom[0], tom[1]) : '') + '</summary><div class="sec-b">' + corpo + '</div></details>';
}
function proximaFase(o) { var f = o.fases || {}; return FASES.find(function (x) { return !(f[x[0]] && f[x[0]].f); }); }

function renderObra() {
  var o = obraAtual(); if (!o) { $('obra-corpo').innerHTML = '<p class="empty">Obra não encontrada.</p>'; return; }
  if (vistaAtual === 'obra') cabecalho();
  var dsp = despesas.filter(function (d) { return d.obraId === o.id; });
  var gasto = dsp.reduce(function (a, d) { return a + (d.valor || 0); }, 0);
  var ds = dias.filter(function (d) { return d.obraId === o.id; });
  var nd = ds.reduce(function (a, d) { return a + (d.fracao || 1); }, 0);
  var rec = recebidoObra(o), falta = Math.max((o.valor || 0) - rec, 0);
  var f = o.fases || {}, p = progFases(o), prox = proximaFase(o);
  var nfeitas = FASES.filter(function (x) { return f[x[0]] && f[x[0]].f; }).length;
  var ep = estadoPlano(o), devida = ep.find(function (e) { return e.devida && e.falta > 0.005; });
  var eq = o.equipa || [], mat = materiais(o), est = o.estado || 'Planeada';
  var tel = String(o.telefone || '').replace(/[^\d+]/g, ''), wa = tel.replace(/^\+/, ''); if (wa.length === 9) wa = '351' + wa;
  var h = '<input id="of_cam" type="file" accept="image/*" capture="environment" hidden><input id="of_gal" type="file" accept="image/*" multiple hidden>';

  // --- topo ---
  var datas = o.inicio ? dataPT(o.inicio) + (o.fim ? ' → ' + dataPT(o.fim) : '') : 'Sem datas marcadas';
  var acts = '';
  if (tel) acts += '<a class="oh-a" href="tel:' + tel + '"><i>' + ICO.tel + '</i>Ligar</a><a class="oh-a" href="https://wa.me/' + wa + '" target="_blank" rel="noopener"><i>' + ICO.wa + '</i>WhatsApp</a>';
  if (o.morada) acts += '<a class="oh-a" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.morada) + '" target="_blank" rel="noopener"><i>' + ICO.mapa + '</i>Mapa</a>';
  if (o.clienteId) acts += '<button type="button" class="oh-a" data-oa="cliente"><i>' + ICO.cli + '</i>Cliente</button>';
  if (o.orcamentoId) acts += '<button type="button" class="oh-a" data-oa="orc"><i>' + ICO.doc + '</i>Orçamento</button>';
  acts += '<button type="button" class="oh-a" data-oa="relatorio"><i>' + ICO.recibo + '</i>Relatório</button>';
  h += '<section class="ohero"><div class="oh-top"><div class="oh-ring">' + anel(p) + '</div><div class="oh-txt"><span class="oh-est e-' + obraCls(est) + '">' + esc(est) + '</span><h2>' + esc(o.nome || 'Obra') + '</h2><p>' + esc([o.cliente, o.morada].filter(Boolean).join(' · ')) + '</p><p class="oh-d">' + ICO.cal + esc(datas) + '</p></div></div><div class="oh-acts">' + acts + '</div></section>';

  // --- o que fazer agora ---
  var ag = [];
  if (!o.inicio && est !== 'Concluída') ag.push(['cal', 'info', 'Marcar as datas da obra', 'Para aparecer na agenda da equipa.', '<button type="button" class="btn small ghost" data-abrir="det">Definir</button>']);
  if (devida) ag.push(['eur', 'warn', 'Cobrar ' + eur(devida.falta), (devida.t.d || 'Pagamento') + ' · ' + quandoTxt(devida.t), '<button type="button" class="btn small acc" data-oa="pagar">Registar</button>']);
  if (prox && est !== 'Concluída') ag.push(['fases', 'blue', (nfeitas ? 'Próxima fase' : 'Primeira fase'), prox[1], '<button type="button" class="btn small" data-fasefeita="' + prox[0] + '">Feita</button>']);
  if (!prox && est !== 'Concluída') ag.push(['flag', 'ok', 'Todas as fases feitas', 'Dar a obra como concluída?', '<button type="button" class="btn small" data-concluir="1">Concluir</button>']);
  if (est === 'Concluída' && falta > 0.005) ag.push(['eur', 'warn', 'Falta receber ' + eur(falta), 'Obra concluída com valores em aberto.', '<button type="button" class="btn small acc" data-oa="pagar">Registar</button>']);
  if (est === 'Concluída' && !falta) ag.push(['recibo', 'ok', 'Obra concluída e paga', 'Entregue o relatório final ao cliente.', '<button type="button" class="btn small ghost" data-oa="relatorio">Relatório</button>']);
  if (ag.length) h += '<section class="card agora"><h2>Agora</h2>' + ag.map(function (a) { return '<div class="ag-r"><span class="ag-ic t-' + a[1] + '">' + ICO[a[0]] + '</span><span class="ag-t"><b>' + esc(a[2]) + '</b><span class="meta">' + esc(a[3]) + '</span></span>' + a[4] + '</div>'; }).join('') + '</section>';

  // --- números ---
  h += '<div class="kgrid">' +
    '<button type="button" class="ktile dest" data-abrir="pag"><small>Recebido</small><b>' + eur(rec) + '</b><span class="kt-s">' + (o.valor ? 'de ' + eur(o.valor) : 'Sem valor acordado') + '</span><span class="kt-bar"><i style="width:' + (o.valor ? Math.min(100, Math.round(rec / o.valor * 100)) : 0) + '%"></i></span></button>' +
    '<button type="button" class="ktile" data-abrir="dsp"><small>Resultado</small><b class="' + ((o.valor || 0) - gasto < 0 ? 'neg' : '') + '">' + eur((o.valor || 0) - gasto) + '</b><span class="kt-s">Despesas ' + eur(gasto) + '</span></button>' +
    '<button type="button" class="ktile" data-abrir="dias"><small>Dias de equipa</small><b>' + fmtN(nd) + '</b><span class="kt-s">' + (eq.length ? esc(eq.join(', ')) : 'Equipa por definir') + '</span></button>' +
    '<button type="button" class="ktile" data-abrir="mat"><small>Área</small><b>' + (o.area ? esc(String(o.area).replace('.', ',')) + ' m²' : '—') + '</b><span class="kt-s">' + (o.iso || o.esp ? esc([o.iso, o.esp ? o.esp + ' cm' : ''].filter(Boolean).join(' · ')) : 'Ver material') + '</span></button></div>';

  // --- fotos em fita ---
  h += '<div class="strip"><label class="strip-add" for="of_cam" aria-label="Tirar fotografia">' + ICO.cam + '<span>Foto</span></label>' + fotosObra.slice(0, 14).map(function (ft) { return '<a href="#" data-verfo="' + ft.id + '"><img src="' + esc(ft.thumb || ft.url || '') + '" alt="Fotografia ' + esc(ft.fase || '') + '" style="pointer-events:none"></a>'; }).join('') + (fotosObra.length > 14 ? '<button type="button" class="strip-mais" data-abrir="fotos">+' + (fotosObra.length - 14) + '</button>' : '') + '</div>';
  if (estadoFotoObra) h += '<p class="hint" id="of-estado">' + esc(estadoFotoObra) + '</p>';

  // --- secções ---
  // pagamentos
  var pc = '<div class="row"><button type="button" class="btn small" data-oa="pagar"' + (o.clienteId ? '' : ' disabled') + '>Registar pagamento</button><button type="button" class="btn ghost small" data-oa="plano">' + (ep.length ? 'Alterar plano' : 'Definir plano') + '</button></div>';
  if (!o.clienteId) pc += '<p class="hint">Esta obra não tem cliente associado.</p>';
  if (ep.length) {
    var soma = (o.plano || []).reduce(function (a, t) { return a + (t.v || 0); }, 0);
    pc += '<div>' + ep.map(function (e) {
      var st = e.falta <= 0.005 ? pill('Pago', 'ok') : e.devida ? pill('Cobrar ' + eur(e.falta), 'warn') : e.pago > 0 ? pill('Falta ' + eur(e.falta)) : pill('Por cobrar');
      return '<div class="mrow2"><span style="flex:1;min-width:0"><b>' + esc(e.t.d || 'Pagamento') + ' · ' + eur(e.t.v) + '</b><span class="meta">' + esc(quandoTxt(e.t)) + '</span></span><span class="q">' + st + '</span></div>';
    }).join('') + '</div>';
    if (o.valor && Math.abs(soma - o.valor) > 0.01) pc += '<p class="hint">O plano soma ' + eur(soma) + ' e o valor acordado é ' + eur(o.valor) + '.</p>';
  } else pc += '<p class="hint">Defina quando o cliente paga (por exemplo 30 % na adjudicação, 40 % a meio, 30 % no fim). A app avisa quando chega a altura de cobrar.</p>';
  var ps = pagsObra(o);
  if (ps.length) pc += '<b class="sub">Recebido</b><div>' + ps.slice().reverse().map(function (x) { return '<div class="mrow2"><span style="flex:1;min-width:0"><b>' + eur(x.valor) + '</b><span class="meta">' + dataPT(x.data) + (x.descricao ? ' · ' + esc(x.descricao) : '') + '</span></span><button type="button" class="btn ghost small" data-recp="' + x.id + '">Recibo</button></div>'; }).join('') + '</div>';
  h += sec('pag', ICO.eur, 'Pagamentos', falta > 0.005 ? 'Falta receber ' + eur(falta) : (o.valor ? 'Tudo recebido' : 'Sem valor acordado'), pc, devida ? ['Cobrar', 'warn'] : null);

  // fases
  var fc = '<div class="prog"><i style="width:' + p + '%"></i></div><ol class="tl">' + FASES.map(function (x) {
    var e = f[x[0]] || {};
    return '<li class="' + (e.f ? 'ok' : '') + (prox && prox[0] === x[0] ? ' prox' : '') + '"><label for="fs_' + x[0] + '"><input type="checkbox" id="fs_' + x[0] + '" data-fase="' + x[0] + '"' + (e.f ? ' checked' : '') + '><span class="tl-dot"></span><span class="tl-t"><b>' + x[1] + '</b>' + (e.f ? '<small>' + dataPT(e.d) + (e.por ? ' · ' + esc(e.por) : '') + '</small>' : '') + '</span></label></li>';
  }).join('') + '</ol>';
  h += sec('fases', ICO.fases, 'Fases do capoto', nfeitas + ' de ' + FASES.length + ' feitas' + (prox ? ' · a seguir: ' + prox[1].toLowerCase() : ''), fc);

  // fotografias
  var fo = '<div class="row" style="align-items:flex-end"><label for="of_fase" style="flex:1 1 120px">Fase das próximas fotos<select id="of_fase">' + opts(FASES_FOTO, faseFotoObra) + '</select></label><label class="btn" for="of_cam" style="color:#fff">' + ICO.cam + 'Tirar</label><label class="btn ghost" for="of_gal">Galeria</label></div>';
  if (fotosObra.length) {
    fo += '<div class="seg"><button type="button" data-fv="todas" aria-selected="' + (vistaFotoObra === 'todas') + '">Todas</button><button type="button" data-fv="ad" aria-selected="' + (vistaFotoObra === 'ad') + '">Antes e depois</button></div>';
    if (vistaFotoObra === 'ad') {
      var an = fotosObra.filter(function (x) { return x.fase === 'Antes' || x.fase === 'Visita'; }), de = fotosObra.filter(function (x) { return x.fase === 'Depois'; });
      fo += '<div class="ad"><div><b>Antes</b><div class="fotos">' + (an.map(function (x) { return fotoCel(x, 'data-verfo', 'data-rmfo'); }).join('') || '<p class="hint">Sem fotos.</p>') + '</div></div><div><b>Depois</b><div class="fotos">' + (de.map(function (x) { return fotoCel(x, 'data-verfo', 'data-rmfo'); }).join('') || '<p class="hint">Sem fotos.</p>') + '</div></div></div>';
    } else fo += '<div class="fotos">' + fotosObra.map(function (x) { return fotoCel(x, 'data-verfo', 'data-rmfo'); }).join('') + '</div>';
  } else fo += '<p class="hint">Tirem fotos antes de começar e no fim: entram no relatório para o cliente.</p>';
  h += sec('fotos', ICO.cam, 'Fotografias', fotosObra.length ? fotosObra.length + (fotosObra.length === 1 ? ' fotografia' : ' fotografias') : 'Ainda sem fotos', fo);

  // material
  var mc = '<div class="grid">' + campo('ob_area', 'Área (m²)', o.area, 'text', ' inputmode="decimal"') + campo('ob_per', 'Perímetro de arranque (m)', o.perim, 'text', ' inputmode="decimal"') + campo('ob_can', 'Cantos e arestas (m)', o.cantos, 'text', ' inputmode="decimal"') + '</div>' +
    (mat ? '<div>' + mat.map(function (r) { return '<div class="mrow2"><b>' + esc(r[0]) + '</b><span class="q">' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span></div>'; }).join('') + '</div><p class="hint">Calculado com os consumos das Definições. Confirmem com a ficha técnica e o fornecedor antes de encomendar.</p><button type="button" class="btn ghost small" data-oa="partilharmat" style="align-self:flex-start">Enviar lista ao fornecedor</button>' : '<p class="hint">Indique a área da obra para calcular o material.</p>');
  h += sec('mat', ICO.caixa, 'Material', mat ? mat.length + ' materiais calculados' : 'Indique a área para calcular', mc);

  // diário
  var dc = '<button type="button" class="btn small" data-oa="novodiario" style="align-self:flex-start">Nova entrada</button>' + (diario.length ? '<div>' + diario.map(function (d) { var par = /Parado|Falta/.test(d.tipo); return '<div class="aviso"><span class="dot ' + (par ? 'no' : 'info') + '"></span><span style="flex:1"><b style="font-size:.9rem">' + dataPT(d.data) + ' · ' + esc(d.tipo) + '</b><span class="meta">' + esc(d.texto || '') + (d.por ? ' — ' + esc(d.por) : '') + '</span></span><button type="button" class="btn danger small ico" data-rmdr="' + d.id + '" aria-label="Apagar registo">' + IC_DEL + '</button></div>'; }).join('') + '</div>' : '<p class="hint">Registem o que se fez em cada dia e os dias parados por chuva ou frio.</p>');
  var parados = diario.filter(function (d) { return /Parado/.test(d.tipo); }).length;
  h += sec('diario', ICO.livro, 'Diário de obra', diario.length ? diario.length + (diario.length === 1 ? ' registo' : ' registos') + ' · último a ' + dataPT(diario[0].data) + (parados ? ' · ' + parados + ' parado' + (parados === 1 ? '' : 's') : '') : 'Sem registos', dc);

  // dias
  var dd = '<button type="button" class="btn small" data-oa="dia" style="align-self:flex-start">Registar dia</button>' + (ds.length ? '<div>' + agrupaDias(ds).slice(0, 20).map(function (g) { return '<button type="button" class="mrow2 dia-ed" data-eddias="' + g.ids.join(',') + '"><span style="flex:1;min-width:0"><b>' + dataPT(g.data) + '</b><span class="meta">' + esc(g.pessoas.join(', ')) + '</span></span><span class="q">' + fmtN(g.total) + (g.total === 1 ? ' dia' : ' dias') + '<small>Alterar</small></span></button>'; }).join('') + '</div>' : '<p class="hint">Ainda sem dias registados.</p>');
  h += sec('dias', ICO.equipa, 'Equipa e dias', fmtN(nd) + (nd === 1 ? ' dia' : ' dias') + ' de trabalho', dd);

  // despesas
  var dpc = '<button type="button" class="btn small" data-oa="despesa" style="align-self:flex-start">Registar despesa</button>' + (dsp.length ? '<div>' + dsp.slice(0, 30).map(dspRow).join('') + '</div>' : '<p class="hint">Ainda sem despesas nesta obra.</p>');
  h += sec('dsp', ICO.recibo, 'Despesas', dsp.length ? eur(gasto) + ' em ' + dsp.length + (dsp.length === 1 ? ' despesa' : ' despesas') : 'Sem despesas', dpc);

  // detalhes
  var dt = '<div class="grid">' + campoSel('ob_estado', 'Estado', EST_OBRA, est) + campo('ob_ini', 'Início', o.inicio, 'date') + campo('ob_fim', 'Fim previsto', o.fim, 'date') + campo('ob_valor', 'Valor acordado (€)', o.valor ? fmtN(o.valor) : '', 'text', ' inputmode="decimal"') + '</div>' +
    '<label>Equipa nesta obra</label><div class="checks">' + pessoas().map(function (n, i) { return '<label for="eq' + i + '"><input type="checkbox" id="eq' + i + '" data-eq="' + esc(n) + '"' + (eq.indexOf(n) >= 0 ? ' checked' : '') + '>' + esc(n) + '</label>'; }).join('') + (pessoas().length ? '' : '<p class="hint">Os nomes aparecem quando a equipa criar as suas contas.</p>') + '</div>' +
    campoTxt('ob_notas', 'Notas da obra', o.notas, 'Acessos, onde deixar material, contactos no local…') +
    '<div class="row"><button type="button" class="btn ghost" data-oa="relatorio">Relatório final para o cliente</button><button type="button" class="btn danger" data-oa="apagar">Apagar obra</button></div>';
  h += sec('det', ICO.ajustes, 'Detalhes da obra', 'Estado, datas, equipa, valor e notas', dt);

  h += '<button type="button" class="fab" data-oa="fab" aria-label="Adicionar à obra">' + ICO.mais + '</button>';

  var foco = document.activeElement && document.activeElement.id;
  $('obra-corpo').innerHTML = h;
  if (foco && $(foco) && /^(ob_|dr_)/.test(foco)) { try { $(foco).focus(); } catch (e) {} }
}
$('obra-corpo').addEventListener('toggle', function (e) { var d = e.target; if (d && d.dataset && d.dataset.sec) secAbertas[d.dataset.sec] = d.open; }, true);
function marcarFase(o, k, feito) {
  var f = Object.assign({}, o.fases || {}); f[k] = feito ? { f: true, d: hoje(), por: porQuem() } : { f: false };
  var d = { fases: f }; if (feito && (o.estado || 'Planeada') === 'Planeada') d.estado = 'Em curso';
  updObra(d); renderObra();
}
function dlgDiario(o) {
  var corpo = '<div class="grid">' + campo('dr_data', 'Dia', hoje(), 'date') + campoSel('dr_tipo', 'Tipo', TIPOS_DIA, 'Trabalho normal') + '</div>' + campoTxt('dr_txt', 'O que se fez / notas', '', 'Ex.: colagem da fachada norte; falta rede para amanhã');
  abrirDlg('Diário de obra', corpo, [{ txt: 'Registar', cls: 'acc', fn: function () {
    var txt = val('dr_txt'), tipo = val('dr_tipo');
    if (!txt && tipo === 'Trabalho normal') { toast('Escreva o que se fez.'); return false; }
    setDoc(doc(collection(db, 'obras', o.id, 'diario')), { data: val('dr_data') || hoje(), tipo: tipo, texto: txt, por: porQuem(), criadoEm: serverTimestamp() }).catch(function (er) { falhou(er, 'registar no diário'); });
    secAbertas.diario = true; toast('Registado no diário.');
  } }]);
}
function dlgFab(o) {
  var it = [['foto', 'cam', 'Fotografia'], ['dia', 'equipa', 'Dia de trabalho'], ['despesa', 'recibo', 'Despesa'], ['pagar', 'eur', 'Pagamento'], ['diario', 'livro', 'Nota no diário'], ['fase', 'fases', 'Fase feita']];
  abrirDlg('Adicionar à obra', '<div class="qa fabg">' + it.map(function (x) { return '<button type="button" class="qbtn" data-fab="' + x[0] + '">' + ICO[x[1]] + '<span>' + x[2] + '</span></button>'; }).join('') + '</div>', []);
  $('dlg-b').onclick = function (e) {
    var b = e.target.closest('[data-fab]'); if (!b) return;
    var a = b.dataset.fab;
    if (a === 'foto') { fecharDlg(); $('of_cam').click(); }
    else if (a === 'dia') dlgDia(o.id);
    else if (a === 'despesa') dlgDespesa(null, o.id);
    else if (a === 'pagar') { if (!o.clienteId) { toast('Esta obra não tem cliente associado.'); return; } dlgPagarObra(o); }
    else if (a === 'diario') dlgDiario(o);
    else if (a === 'fase') { var px = proximaFase(o); fecharDlg(); if (px) { marcarFase(o, px[0], true); toast('Fase feita: ' + px[1] + '.'); } else toast('Todas as fases já estão feitas.'); }
  };
}
$('obra-corpo').addEventListener('click', function (e) {
  var o = obraAtual(); if (!o) return;
  var b = e.target.closest('[data-abrir],[data-fasefeita],[data-concluir],[data-oa="fab"],[data-oa="novodiario"]'); if (!b) return;
  if (b.dataset.abrir) {
    var k = b.dataset.abrir; secAbertas[k] = true; renderObra();
    var el = document.querySelector('#obra-corpo [data-sec="' + k + '"]'); if (el) { el.open = true; setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
  } else if (b.dataset.fasefeita) { var nm = (FASES.find(function (x) { return x[0] === b.dataset.fasefeita; }) || [])[1]; marcarFase(o, b.dataset.fasefeita, true); toast('Fase feita: ' + nm + '.'); }
  else if (b.dataset.concluir) { updObra({ estado: 'Concluída', fim: o.fim && o.fim <= hoje() ? o.fim : hoje() }); renderObra(); toast('Obra concluída.'); }
  else if (b.dataset.oa === 'fab') dlgFab(o);
  else if (b.dataset.oa === 'novodiario') dlgDiario(o);
});

// =====================================================================
// INÍCIO (painel do dia)
// =====================================================================
var DIAS_S = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function diaRot(iso) { var h = hoje(); if (iso === h) return 'Hoje'; if (iso === addDias(h, 1)) return 'Amanhã'; var d = new Date(iso + 'T12:00:00'); return DIAS_S[d.getDay()] + ' ' + d.getDate(); }
function anelMini(p) { var c = 2 * Math.PI * 16; return '<span class="anel-m"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="a-bg"/><circle cx="20" cy="20" r="16" class="a-fg" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p / 100)).toFixed(1) + '"/></svg><b>' + p + '</b></span>'; }
function avisoInfo(a) {
  var t = a[3].split(':')[0], cobrar = /^Cobrar/.test(a[1]);
  if (cobrar) return ['eur', 'warn', 'Registar', 'pagar:' + a[3].split(':')[1]];
  return ({ orc: ['doc', 'warn', 'Ver'], criarobra: ['caixa', 'info', 'Criar obra'], ped: ['cli', 'info', 'Abrir'], obra: ['fases', a[0] === 'no' ? 'warn' : 'blue', 'Abrir'], doc: ['recibo', a[0] === 'no' ? 'warn' : 'info', 'Ver'] })[t].concat([a[3]]);
}
function renderInicio() {
  var emCurso = obras.filter(function (o) { return o.estado === 'Em curso'; });
  var pend = orcs.filter(function (o) { return o.estado === 'Por enviar' || o.estado === 'Enviado'; });
  var pedN = pedidos.filter(function (p) { return (p.estado || 'Novo') === 'Novo' || p.estado === 'Visita marcada'; }).length;
  var mes = mesAtual(), dm = despesas.filter(function (d) { return (d.data || '').slice(0, 7) === mes; }).reduce(function (a, d) { return a + (d.valor || 0); }, 0);
  var dMes = dias.filter(function (d) { return (d.data || '').slice(0, 7) === mes; }).reduce(function (a, d) { return a + (d.fracao || 1); }, 0);
  var aceite = orcs.filter(function (o) { return o.estado === 'Aceite' || o.estado === 'Concluído'; }).reduce(function (a, o) { return a + (o.total || 0); }, 0);
  var pr = porReceberTotal(), recebido = Math.max(aceite - pr, 0);
  var h = '';
  // topo
  h += '<section class="ohero ihero"><div class="ih-top"><div><small>Por receber</small><b>' + eur(pr) + '</b><span class="kt-bar"><i style="width:' + (aceite ? Math.round(recebido / aceite * 100) : 0) + '%"></i></span><span class="ih-s">' + (aceite ? 'Recebido ' + eur(recebido) + ' de ' + eur(aceite) + ' aceites' : 'Ainda sem orçamentos aceites') + '</span></div></div>' +
    '<div class="ih-chips"><button type="button" data-goto="obras"><b>' + emCurso.length + '</b>em curso</button><button type="button" data-goto="orcs"><b>' + pend.length + '</b>orçamentos pendentes</button><button type="button" data-goto="clientes" data-ped="1"><b>' + pedN + '</b>pedidos por tratar</button></div>' +
    '<div class="oh-acts"><button type="button" class="oh-a" data-qa="pedido"><i>' + ICO.cli + '</i>Pedido</button><button type="button" class="oh-a" data-qa="orc"><i>' + ICO.doc + '</i>Orçamento</button><button type="button" class="oh-a" data-qa="despesa"><i>' + ICO.recibo + '</i>Despesa</button><button type="button" class="oh-a" data-qa="dia"><i>' + ICO.equipa + '</i>Dia</button><button type="button" class="oh-a" data-goto="obras" data-ag="1"><i>' + ICO.cal + '</i>Agenda</button></div></section>';
  // agora
  var A = avisos();
  h += '<section class="card agora"><div class="titulo"><h2>Agora</h2>' + (A.length ? '<span class="badge-n">' + A.length + '</span>' : '') + '</div>' + (A.length ? A.slice(0, 6).map(function (a) {
    var i = avisoInfo(a);
    return '<div class="ag-r" data-av="' + i[3] + '"><span class="ag-ic t-' + i[1] + '">' + ICO[i[0]] + '</span><span class="ag-t"><b>' + esc(a[1]) + '</b><span class="meta">' + esc(a[2]) + '</span></span><button type="button" class="btn small ' + (i[1] === 'warn' ? 'acc' : 'ghost') + '" data-av="' + i[3] + '">' + i[2] + '</button></div>';
  }).join('') + (A.length > 6 ? '<p class="hint">+ ' + (A.length - 6) + (A.length - 6 === 1 ? ' aviso' : ' avisos') + '</p>' : '') : '<div class="ag-r"><span class="ag-ic t-ok">' + ICO.fases + '</span><span class="ag-t"><b>Está tudo em dia</b><span class="meta">Sem cobranças, visitas ou prazos pendentes.</span></span></div>') + '</section>';
  // obras em curso
  var ob = obras.filter(function (o) { return o.estado === 'Em curso' || o.estado === 'Parada' || (o.estado === 'Planeada' && o.inicio && diasEntre(hoje(), o.inicio) <= 14); });
  h += '<div class="titulo sec-tit"><h2>Obras</h2><button type="button" class="lnk" data-goto="obras">Ver todas</button></div>';
  h += ob.length ? '<div class="carr">' + ob.map(function (o) {
    var px = proximaFase(o);
    return '<button type="button" class="ocard" data-obra="' + o.id + '">' + anelMini(progFases(o)) + '<span class="oc-t"><span class="pill ' + obraCls(o.estado) + '">' + esc(o.estado) + '</span><b>' + esc(o.nome) + '</b><span class="meta">' + esc(px ? 'A seguir: ' + px[1] : 'Fases todas feitas') + '</span><span class="meta">' + esc((o.equipa || []).join(', ') || 'Equipa por definir') + '</span></span></button>';
  }).join('') + '</div>' : '<section class="card"><p class="hint">Nenhuma obra em curso. As obras criam-se a partir de um orçamento aceite.</p></section>';
  // semana
  var ev = eventos(hoje(), addDias(hoje(), 6));
  var dd = ''; for (var k = 0; k < 7; k++) { var d = addDias(hoje(), k), n = ev.filter(function (e) { return e.ini <= d && e.fim >= d; }).length, dt = new Date(d + 'T12:00:00'); dd += '<span class="dch' + (k === 0 ? ' hoje' : '') + '"><small>' + DIAS_S[dt.getDay()] + '</small><b>' + dt.getDate() + '</b><i>' + (n ? '<em></em>'.repeat(Math.min(n, 3)) : '') + '</i></span>'; }
  var lista = '', fimS = addDias(hoje(), 6);
  var longas = ev.filter(function (e) { return e.tipo === 'obra'; });
  if (longas.length) lista += '<div class="wk">A decorrer</div>' + longas.map(function (e) { return '<button type="button" class="ag" data-ev="obra:' + e.id + '"><span class="bar"></span><span style="flex:1;min-width:0"><b style="display:block">' + esc(e.titulo) + '</b><span class="meta">' + (e.ini > hoje() ? 'Começa ' + diaRot(e.ini).toLowerCase() : 'Até ' + dataPT(e.fim)) + ' · ' + esc(e.sub) + '</span></span></button>'; }).join('');
  for (var k2 = 0; k2 < 7; k2++) {
    var d2 = addDias(hoje(), k2), no = ev.filter(function (e) { return e.tipo !== 'obra' && e.ini === d2; });
    if (!no.length) continue;
    lista += '<div class="wk">' + diaRot(d2) + '</div>' + no.map(function (e) { return '<button type="button" class="ag visita" data-ev="' + e.tipo + ':' + e.id + '"><span class="bar"></span><span style="flex:1;min-width:0"><b style="display:block">' + esc(e.titulo) + '</b><span class="meta">' + esc(e.sub) + '</span></span></button>'; }).join('');
  }
  h += '<section class="card"><div class="titulo"><h2>Esta semana</h2><button type="button" class="lnk" data-goto="obras" data-ag="1">Agenda</button></div><div class="dias7">' + dd + '</div>' + (lista || '<p class="hint">Nada marcado para os próximos 7 dias.</p>') + '</section>';
  // mês
  h += '<div class="titulo sec-tit"><h2>' + nomeMes(mes).replace(/^\w/, function (c) { return c.toUpperCase(); }) + '</h2><button type="button" class="lnk" data-goto="contas">Contas</button></div>';
  h += '<div class="kgrid"><button type="button" class="ktile" data-goto="despesas"><small>Despesas</small><b>' + eur(dm) + '</b><span class="kt-s">Combustível, material…</span></button><button type="button" class="ktile" data-goto="dias"><small>Dias de equipa</small><b>' + fmtN(dMes) + '</b><span class="kt-s">Registados este mês</span></button></div>';
  $('ini-corpo').innerHTML = h;
}
$('ini-corpo').addEventListener('click', function (e) {
  var b = e.target.closest('[data-qa],[data-av],[data-obra],[data-ev],[data-goto]'); if (!b) return;
  if (b.dataset.qa) {
    var a = b.dataset.qa;
    if (a === 'pedido') dlgPedido(null);
    else if (a === 'orc') { if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Começar um novo na mesma?')) return; cur = blankQuote(); dirty = false; lsSet(K_DRAFT, { q: cur, dirty: false }); toForm(cur); show('novo'); }
    else if (a === 'despesa') dlgDespesa(null);
    else if (a === 'dia') dlgDia(null);
  } else if (b.dataset.av) {
    var p = b.dataset.av.split(':');
    if (p[0] === 'pagar') { var oo = obras.find(function (x) { return x.id === p[1]; }); if (oo) dlgPagarObra(oo); }
    else if (p[0] === 'obra') abrirObra(p[1]);
    else if (p[0] === 'ped') dlgPedido(p[1]);
    else if (p[0] === 'doc') dlgDoc(p[1]);
    else if (p[0] === 'criarobra') { var o = orcs.find(function (x) { return x.id === p[1]; }); if (o) criarObraDeOrc(o); }
    else if (p[0] === 'orc') { var q = orcs.find(function (x) { return x.id === p[1]; }); if (q && q.clienteId) abrirCliente(q.clienteId); else show('orcs'); }
  } else if (b.dataset.obra) abrirObra(b.dataset.obra);
  else if (b.dataset.ev) clickEv(e);
  else if (b.dataset.goto) {
    show(b.dataset.goto);
    if (b.dataset.ag) document.querySelector('[data-oseg="agenda"]').click();
    if (b.dataset.ped) document.querySelector('[data-seg="ped"]').click();
  }
});

// =====================================================================
// PASTA DO CLIENTE
// =====================================================================
var secCli = { orcs: true, obras: true, pags: false, fotos: false };
function renderClienteDyn() {
  if (!clienteAberto) { $('cf-dyn').innerHTML = ''; return; }
  var c = clientes.find(function (x) { return x.id === clienteAberto; }) || {};
  var os = orcs.filter(function (o) { return o.clienteId === clienteAberto; });
  var ob = obras.filter(function (o) { return o.clienteId === clienteAberto; });
  var aceite = os.filter(function (o) { return o.estado === 'Aceite' || o.estado === 'Concluído'; }).reduce(function (a, o) { return a + (o.total || 0); }, 0);
  var pago = pagamentos.reduce(function (a, p) { return a + (p.valor || 0); }, 0), falta = Math.max(aceite - pago, 0);
  var tel = String(c.telefone || '').replace(/[^\d+]/g, '');
  var h = '';
  // agora
  var ag = [];
  os.forEach(function (o) {
    if (o.estado === 'Por enviar') ag.push(['doc', 'info', 'Orçamento ' + o.num + ' por enviar', eur(o.total) + ' · criado a ' + dataPT(o.data), '<button type="button" class="btn small ghost" data-cfopen="' + o.id + '">Abrir</button>']);
    if (o.estado === 'Enviado') { var dd = diasEntre(o.enviadoEm || o.data, hoje()); ag.push(['doc', dd >= 7 ? 'warn' : 'info', 'Orçamento ' + o.num + ' enviado', (dd ? 'Há ' + dd + (dd === 1 ? ' dia' : ' dias') : 'Hoje') + ' · ' + eur(o.total) + (dd >= 7 ? ' · vale a pena ligar' : ''), tel ? '<a class="btn small ' + (dd >= 7 ? 'acc' : 'ghost') + '" href="tel:' + tel + '">Ligar</a>' : '']); }
    if (o.estado === 'Aceite' && !obras.some(function (b) { return b.orcamentoId === o.id; })) ag.push(['caixa', 'warn', 'Orçamento ' + o.num + ' aceite', 'Crie a obra para planear datas, equipa e material.', '<button type="button" class="btn small acc" data-cfmk="' + o.id + '">Criar obra</button>']);
  });
  ob.forEach(function (o) {
    estadoPlano(o).forEach(function (e) { if (e.devida && e.falta > 0.005) ag.push(['eur', 'warn', 'Cobrar ' + eur(e.falta), (e.t.d || 'Pagamento') + ' · ' + o.nome, '<button type="button" class="btn small acc" data-cfpagar="' + o.id + '">Registar</button>']); });
    if (o.estado === 'Em curso' || o.estado === 'Parada') { var px = proximaFase(o); ag.push(['fases', 'blue', 'Obra ' + o.estado.toLowerCase() + ' · ' + progFases(o) + ' %', px ? 'A seguir: ' + px[1] : 'Fases todas feitas', '<button type="button" class="btn small ghost" data-obra="' + o.id + '">Abrir</button>']); }
  });
  if (!os.length && !ob.length) ag.push(['doc', 'info', 'Fazer o primeiro orçamento', 'Os dados do cliente entram automaticamente.', '<button type="button" class="btn small" data-cfa="orc">Novo</button>']);
  if (ag.length) h += '<section class="card agora"><h2>Agora</h2>' + ag.map(function (a) { return '<div class="ag-r"><span class="ag-ic t-' + a[1] + '">' + ICO[a[0]] + '</span><span class="ag-t"><b>' + esc(a[2]) + '</b><span class="meta">' + esc(a[3]) + '</span></span>' + a[4] + '</div>'; }).join('') + '</section>';
  // números
  var ult = os[0];
  h += '<div class="kgrid"><button type="button" class="ktile dest" data-cabrir="pags"><small>Falta receber</small><b>' + eur(falta) + '</b><span class="kt-bar"><i style="width:' + (aceite ? Math.min(100, Math.round(pago / aceite * 100)) : 0) + '%"></i></span><span class="kt-s">Recebido ' + eur(pago) + (aceite ? ' de ' + eur(aceite) : '') + '</span></button>' +
    '<button type="button" class="ktile" data-cabrir="orcs"><small>Orçamentos</small><b>' + os.length + '</b><span class="kt-s">' + (ult ? 'Último: ' + esc(ult.estado || 'Por enviar') : 'Nenhum ainda') + '</span></button></div>';
  // fotos
  h += '<div class="strip"><label class="strip-add" for="cf_cam" aria-label="Tirar fotografia">' + ICO.cam + '<span>Foto</span></label>' + fotos.slice(0, 14).map(function (f) { return '<a href="#" data-cfverf="' + f.id + '"><img src="' + esc(f.thumb || f.url || '') + '" alt="Fotografia ' + esc(f.fase || '') + '" style="pointer-events:none"></a>'; }).join('') + (fotos.length > 14 ? '<button type="button" class="strip-mais" data-cabrir="fotos">+' + (fotos.length - 14) + '</button>' : '') + '</div>';
  $('cf-dyn').innerHTML = h;
  // resumos das secções
  $('cs-orcs').textContent = os.length ? os.length + (os.length === 1 ? ' orçamento' : ' orçamentos') + ' · ' + eur(os.reduce(function (a, o) { return a + (o.total || 0); }, 0)) : 'Nenhum orçamento';
  $('cs-obras').textContent = ob.length ? ob.map(function (o) { return o.estado; }).join(', ') : 'Nenhuma obra';
  $('cs-pags').textContent = pagamentos.length ? pagamentos.length + (pagamentos.length === 1 ? ' pagamento' : ' pagamentos') + ' · ' + eur(pago) : 'Sem pagamentos';
  $('cs-fotos').textContent = fotos.length ? fotos.length + (fotos.length === 1 ? ' fotografia' : ' fotografias') : 'Ainda sem fotos';
  $('cs-dados').textContent = [c.telefone, c.nif && 'NIF ' + c.nif, c.email].filter(Boolean).join(' · ') || 'Telefone, NIF, morada e notas';
}
function fichaTopo(c) {
  c = c || {};
  var av = $('cf-av'); av.textContent = iniciais(c.nome || '+'); av.style.background = corDe(c.nome || '');
  $('cf-sub').textContent = c.morada || (clienteAberto ? 'Sem morada' : 'Preencha os dados e guarde');
  var os = clienteAberto ? orcs.filter(function (o) { return o.clienteId === clienteAberto; }) : [], ob = clienteAberto ? obras.filter(function (o) { return o.clienteId === clienteAberto; }) : [];
  var est = !clienteAberto ? 'Novo cliente' : ob.some(function (o) { return o.estado === 'Em curso'; }) ? 'Obra em curso' : ob.some(function (o) { return o.estado === 'Concluída'; }) && !ob.some(function (o) { return o.estado !== 'Concluída'; }) ? 'Obra concluída' : os.some(function (o) { return o.estado === 'Aceite'; }) ? 'Orçamento aceite' : os.length ? 'Em orçamento' : 'Contacto';
  $('cf-est').textContent = est; $('cf-est').className = 'oh-est' + (est === 'Obra em curso' || est === 'Orçamento aceite' ? ' e-warn' : est === 'Obra concluída' ? ' e-ok' : '');
  var tel = String(c.telefone || '').replace(/[^\d+]/g, ''), wa = tel.replace(/^\+/, ''); if (wa.length === 9) wa = '351' + wa;
  var a = '';
  if (tel) a += '<a class="oh-a" href="tel:' + tel + '"><i>' + ICO.tel + '</i>Ligar</a><a class="oh-a" href="https://wa.me/' + wa + '" target="_blank" rel="noopener"><i>' + ICO.wa + '</i>WhatsApp</a>';
  if (c.morada) a += '<a class="oh-a" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.morada) + '" target="_blank" rel="noopener"><i>' + ICO.mapa + '</i>Mapa</a>';
  if (c.email) a += '<a class="oh-a" href="mailto:' + esc(c.email) + '"><i>' + SV('<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/>') + '</i>Email</a>';
  a += '<button type="button" class="oh-a" data-cfa="orc"><i>' + ICO.doc + '</i>Orçamento</button><button type="button" class="oh-a" data-cfa="obra"><i>' + ICO.caixa + '</i>Obra</button>';
  $('cf-acts').innerHTML = clienteAberto ? a : '';
}
function renderKpis() { renderClienteDyn(); }
function dlgPagarCli() {
  var ob = obras.filter(function (o) { return o.clienteId === clienteAberto; });
  var corpo = '<div class="grid">' + campo('pc_data', 'Data', hoje(), 'date') + campo('pc_valor', 'Valor (€)', '', 'text', ' inputmode="decimal"') + '</div>' + campo('pc_desc', 'Descrição', '', 'text', ' placeholder="Ex.: adjudicação, 2.ª prestação"') + (ob.length ? campoSel('pc_obra', 'Obra', [['', 'Sem obra']].concat(ob.map(function (o) { return [o.id, o.nome]; })), ob.length === 1 ? ob[0].id : '') : '');
  function gravar() {
    var v = num(val('pc_valor')); if (!v) { toast('Escreva o valor.'); return null; }
    var ref = doc(collection(db, 'clientes', clienteAberto, 'pagamentos'));
    var p = { data: val('pc_data') || hoje(), valor: v, descricao: val('pc_desc'), obraId: (ob.length && val('pc_obra')) || null, por: porQuem(), criadoEm: serverTimestamp() };
    setDoc(ref, p).catch(function (e) { falhou(e, 'registar o pagamento'); });
    toast('Pagamento de ' + eur(v) + ' registado.');
    return Object.assign({ id: ref.id, clienteId: clienteAberto }, p);
  }
  abrirDlg('Registar pagamento', corpo, [
    { txt: 'Guardar e fazer recibo', cls: 'ghost', fn: function () { var p = gravar(); if (!p) return false; reciboPDF(p, p.clienteId).catch(function (e) { console.error(e); toast('Não foi possível gerar o recibo.'); }); } },
    { txt: 'Guardar', cls: 'acc', fn: function () { if (!gravar()) return false; } }
  ]);
}
function abrirSecCli(k) { var el = document.querySelector('#v-cliente [data-csec="' + k + '"]'); if (!el) return; el.open = true; setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
$('v-cliente').addEventListener('toggle', function (e) { var d = e.target; if (d && d.dataset && d.dataset.csec && secCli[d.dataset.csec] !== undefined) secCli[d.dataset.csec] = d.open; }, true);
$('v-cliente').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cfa],[data-cabrir],[data-cfopen],[data-cfmk],[data-cfpagar],[data-cfverf],#cf-dyn [data-obra],#cf-fab'); if (!b || !clienteAberto) return;
  if (b.id === 'cf-fab') {
    var it = [['orc', 'doc', 'Orçamento'], ['obra', 'caixa', 'Obra'], ['pagar', 'eur', 'Pagamento'], ['foto', 'cam', 'Fotografia'], ['galeria', 'cam', 'Da galeria'], ['dados', 'cli', 'Editar dados']];
    abrirDlg('Adicionar ao cliente', '<div class="qa fabg">' + it.map(function (x) { return '<button type="button" class="qbtn" data-fab="' + x[0] + '">' + ICO[x[1]] + '<span>' + x[2] + '</span></button>'; }).join('') + '</div>', []);
    $('dlg-b').onclick = function (ev) {
      var q = ev.target.closest('[data-fab]'); if (!q) return; var a = q.dataset.fab;
      if (a === 'orc') { fecharDlg(); $('cf-novoorc').click(); }
      else if (a === 'obra') dlgNovaObra(clienteAberto);
      else if (a === 'pagar') dlgPagarCli();
      else if (a === 'foto') { fecharDlg(); $('cf_cam').click(); }
      else if (a === 'galeria') { fecharDlg(); $('f_ficheiros').click(); }
      else if (a === 'dados') { fecharDlg(); abrirSecCli('dados'); }
    };
    return;
  }
  e.preventDefault();
  if (b.dataset.cfa === 'orc') $('cf-novoorc').click();
  else if (b.dataset.cfa === 'obra') dlgNovaObra(clienteAberto);
  else if (b.dataset.cabrir) abrirSecCli(b.dataset.cabrir);
  else if (b.dataset.cfopen) { var x = orcs.find(function (o) { return o.id === b.dataset.cfopen; }); if (x) { cur = { id: x.id, num: x.num, data: x.data, estado: x.estado || 'Por enviar', f: JSON.parse(JSON.stringify(x.f || {})), extras: JSON.parse(JSON.stringify(x.extras || [])), clienteId: x.clienteId || null, medicao: x.medicao ? JSON.parse(JSON.stringify(x.medicao)) : null }; dirty = false; toForm(cur); show('novo'); } }
  else if (b.dataset.cfmk) { var o = orcs.find(function (z) { return z.id === b.dataset.cfmk; }); if (o) criarObraDeOrc(o); }
  else if (b.dataset.cfpagar) { var ob = obras.find(function (z) { return z.id === b.dataset.cfpagar; }); if (ob) dlgPagarObra(ob); }
  else if (b.dataset.cfverf) verFotoEm(b.dataset.cfverf, fotos, ['clientes', clienteAberto]);
  else if (b.dataset.obra) abrirObra(b.dataset.obra);
});
$('cf_cam').addEventListener('change', async function (e) {
  var files = [].slice.call(e.target.files || []); e.target.value = '';
  if (!files.length || !clienteAberto) return;
  var est = $('f-estado');
  await enviarFotos(files, ['clientes', clienteAberto], {}, $('f_fase').value, function (t) { est.textContent = t; });
});

// =====================================================================
// LISTAS (clientes, pedidos, obras, orçamentos) e ficha do orçamento
// =====================================================================
function cidade(m) { var p = String(m || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); return p.length > 1 ? p[p.length - 1] : (p[0] || ''); }
function estadoCli(id) {
  var os = orcs.filter(function (o) { return o.clienteId === id; }), ob = obras.filter(function (o) { return o.clienteId === id; });
  if (ob.some(function (o) { return o.estado === 'Em curso' || o.estado === 'Parada'; })) return ['Obra em curso', 'warn', 'obra'];
  if (ob.some(function (o) { return o.estado === 'Planeada'; })) return ['Obra marcada', 'info', 'obra'];
  if (ob.length) return ['Obra concluída', 'ok', 'concl'];
  if (os.some(function (o) { return o.estado === 'Aceite'; })) return ['Orçamento aceite', 'ok', 'orc'];
  if (os.some(function (o) { return o.estado === 'Enviado' || o.estado === 'Por enviar'; })) return ['Em orçamento', '', 'orc'];
  if (os.length) return ['Orçamento recusado', 'no', 'outro'];
  return ['Contacto', '', 'outro'];
}
function telA(tel) { var t = String(tel || '').replace(/[^\d+]/g, ''); return t ? '<a class="ic-call" href="tel:' + t + '" aria-label="Ligar">' + ICO.tel + '</a>' : ''; }
var filtroCli = 'Todos';
function renderClientes() {
  var q = ($('cli_filtro').value || '').toLowerCase();
  var fs = [['Todos', null], ['Em orçamento', 'orc'], ['Com obra', 'obra'], ['Concluídos', 'concl']];
  $('cli-filtros').innerHTML = fs.map(function (f) { var n = f[1] ? clientes.filter(function (c) { return estadoCli(c.id)[2] === f[1]; }).length : clientes.length; return '<button type="button" class="chip-f" data-fc="' + f[0] + '" aria-pressed="' + (f[0] === filtroCli) + '">' + f[0] + ' · ' + n + '</button>'; }).join('');
  var fk = (fs.find(function (f) { return f[0] === filtroCli; }) || [])[1];
  var items = clientes.filter(function (c) { return (!q || ((c.nome || '') + ' ' + (c.telefone || '') + ' ' + (c.morada || '')).toLowerCase().indexOf(q) >= 0) && (!fk || estadoCli(c.id)[2] === fk); })
    .sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || '', 'pt'); });
  var h = '', letra = '';
  items.forEach(function (c) {
    var l = (c.nome || '#').trim().charAt(0).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (l !== letra) { if (letra) h += '</div>'; letra = l; h += '<div class="grp-l">' + esc(l) + '</div><div class="card list lst">'; }
    var e = estadoCli(c.id);
    h += '<div class="row-i" role="button" tabindex="0" data-cli="' + c.id + '">' + avatar(c.nome) + '<span class="grow"><b>' + esc(c.nome || 'Sem nome') + '</b><span class="meta"><span class="est-d d-' + (e[1] || 'n') + '"></span>' + esc(e[0]) + (cidade(c.morada) ? ' · ' + esc(cidade(c.morada)) : '') + '</span></span>' + telA(c.telefone) + '</div>';
  });
  if (letra) h += '</div>';
  $('cli-lista').innerHTML = h || '<section class="card"><p class="empty">' + (clientes.length ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes. Carregue em "Novo" ou guarde um orçamento.') + '</p></section>';
  cabecalho();
}
$('cli_filtro').addEventListener('input', renderClientes);
$('cli-filtros').addEventListener('click', function (e) { var b = e.target.closest('[data-fc]'); if (b) { filtroCli = b.dataset.fc; renderClientes(); } });
$('cli-lista').addEventListener('click', function (e) { if (e.target.closest('a')) return; var b = e.target.closest('[data-cli]'); if (b) abrirCliente(b.dataset.cli); });
$('cli-lista').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var b = e.target.closest('[data-cli]'); if (b) abrirCliente(b.dataset.cli); } });

function renderPedidos() {
  var ordem = { 'Novo': 0, 'Visita marcada': 1, 'Orçamentado': 2, 'Perdido': 3 };
  var it = pedidos.slice().sort(function (a, b) { return (ordem[a.estado] || 0) - (ordem[b.estado] || 0) || (b.data || '').localeCompare(a.data || ''); });
  var grupos = [['Por tratar', function (p) { return !p.estado || p.estado === 'Novo'; }], ['Visita marcada', function (p) { return p.estado === 'Visita marcada'; }], ['Tratados', function (p) { return p.estado === 'Orçamentado' || p.estado === 'Perdido'; }]];
  var h = '';
  grupos.forEach(function (g) {
    var l = it.filter(g[1]); if (!l.length) return;
    h += '<div class="grp-l">' + g[0] + ' · ' + l.length + '</div><div class="card list lst">' + l.map(function (p) {
      var sub = p.visita ? (diaRot(p.visita) === 'Hoje' || diaRot(p.visita) === 'Amanhã' ? diaRot(p.visita) : dataPT(p.visita)) + (p.hora ? ' às ' + p.hora : '') : (p.origem || '') + (p.data ? ' · há ' + Math.max(0, diasEntre(p.data, hoje())) + ' dias' : '');
      return '<div class="row-i" role="button" tabindex="0" data-ped="' + p.id + '">' + avatar(p.nome) + '<span class="grow"><b>' + esc(p.nome || 'Sem nome') + '</b><span class="meta">' + (p.visita ? ICO.cal.replace('<svg ', '<svg class="mi" ') : '') + esc(sub) + (p.morada ? ' · ' + esc(cidade(p.morada)) : '') + '</span>' + (p.descricao ? '<span class="meta trunc">' + esc(p.descricao) + '</span>' : '') + '</span>' + (p.estado === 'Orçamentado' || p.estado === 'Perdido' ? '<span class="end">' + pill(p.estado, pedCls(p.estado)) + '</span>' : '') + telA(p.telefone) + '</div>';
    }).join('') + '</div>';
  });
  $('ped-lista').innerHTML = h || '<section class="card"><p class="empty">Sem pedidos. Registe aqui quem liga ou manda mensagem a pedir orçamento.</p></section>';
  var n = pedidos.filter(function (p) { return p.estado === 'Novo' || p.estado === 'Visita marcada' || !p.estado; }).length;
  $('ped-badge').hidden = !n; $('ped-badge').textContent = n;
}
$('ped-lista').addEventListener('click', function (e) { if (e.target.closest('a')) return; var b = e.target.closest('[data-ped]'); if (b) dlgPedido(b.dataset.ped); });

function obraRow(o) {
  var p = progFases(o), px = proximaFase(o), eq = o.equipa || [];
  var datas = o.inicio ? dataPT(o.inicio).slice(0, 5) + (o.fim ? ' – ' + dataPT(o.fim).slice(0, 5) : '') : 'Sem datas';
  return '<button type="button" class="ob-c" data-obra="' + o.id + '">' + anelMini(p) + '<span class="grow"><span class="ob-h"><b>' + esc(o.nome || 'Obra') + '</b>' + pill(o.estado || 'Planeada', obraCls(o.estado)) + '</span><span class="meta">' + esc([o.cliente && o.nome.indexOf(o.cliente) < 0 ? o.cliente : '', cidade(o.morada)].filter(Boolean).join(' · ')) + '</span>' +
    '<span class="ob-f"><span class="meta">' + ICO.cal.replace('<svg ', '<svg class="mi" ') + esc(datas) + '</span><span class="meta">' + esc(o.estado === 'Concluída' ? 'Concluída' : px ? px[1] : 'Fases feitas') + '</span></span>' +
    (eq.length ? '<span class="eqs">' + eq.slice(0, 4).map(function (n) { return '<span class="av mini" style="background:' + corDe(n) + '" title="' + esc(n) + '">' + esc(iniciais(n)) + '</span>'; }).join('') + '</span>' : '') + '</span></button>';
}

// ---------- orçamentos ----------
function orcHTML(items, mostrarCliente) {
  if (!items.length) return '<p class="empty">Ainda não há orçamentos.</p>';
  return items.map(function (x) {
    var e = x.estado || 'Por enviar', ob = obras.some(function (b) { return b.orcamentoId === x.id; });
    var sub = mostrarCliente ? 'N.º ' + x.num + ' · ' + dataPT(x.data) + (x.morada ? ' · ' + cidade(x.morada) : '') : dataPT(x.data) + (x.morada ? ' · ' + x.morada : '');
    var extra = e === 'Enviado' ? (function () { var d = diasEntre(x.enviadoEm || x.data, hoje()); return d >= 7 ? '<span class="meta warn-t">Sem resposta há ' + d + ' dias</span>' : ''; })() : (e === 'Aceite' && !ob ? '<span class="meta warn-t">Falta criar a obra</span>' : '');
    return '<button type="button" class="orc-r e-' + estClasse(e) + '" data-orcx="' + x.id + '"><span class="grow"><b>' + esc(mostrarCliente ? (x.cliente || 'Sem nome') : 'N.º ' + x.num) + '</b><span class="meta">' + esc(sub) + '</span>' + extra + '</span><span class="end"><b>' + eur(x.total) + '</b>' + pillEstado(e) + '</span></button>';
  }).join('');
}
function abrirOrcForm(x, dup) {
  if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Continuar na mesma?')) return;
  cur = { id: x.id, num: x.num, data: x.data, estado: x.estado || 'Por enviar', f: JSON.parse(JSON.stringify(x.f || {})), extras: JSON.parse(JSON.stringify(x.extras || [])), clienteId: x.clienteId || null, medicao: x.medicao ? JSON.parse(JSON.stringify(x.medicao)) : null };
  if (dup) { cur.id = null; cur.num = null; cur.data = null; cur.estado = 'Por enviar'; }
  dirty = !!dup; lsSet(K_DRAFT, { q: cur, dirty: dirty }); toForm(cur); show('novo');
  if (dup) toast('Cópia criada. Altere o que precisar e guarde.');
}
function mudarEstado(x, e) {
  var up = { estado: e, atualizadoEm: serverTimestamp(), atualizadoPor: porQuem() };
  if (e === 'Enviado') up.enviadoEm = hoje();
  updateDoc(doc(db, 'orcamentos', x.id), up).catch(function (er) { falhou(er, 'mudar o estado'); });
  x.estado = e; if (up.enviadoEm) x.enviadoEm = up.enviadoEm;
  if (cur && cur.id === x.id) cur.estado = e;
}
function dlgOrc(id) {
  var x = orcs.find(function (o) { return o.id === id; }); if (!x) return;
  function corpo() {
    var e = x.estado || 'Por enviar', ob = obras.find(function (b) { return b.orcamentoId === x.id; });
    var acts = [['abrir', 'doc', 'Abrir e editar'], ['dup', 'recibo', 'Duplicar']];
    if (e === 'Aceite' || e === 'Concluído' || ob) acts.push(['obra', 'caixa', ob ? 'Ver obra' : 'Criar obra']);
    if (x.clienteId) acts.push(['cli', 'cli', 'Pasta do cliente']);
    acts.push(['apagar', 'ajustes', 'Apagar']);
    return '<div class="orc-hd"><span class="meta">N.º ' + esc(x.num) + ' · ' + dataPT(x.data) + '</span><b class="orc-tot">' + eur(x.total) + '</b><span>' + esc(x.cliente || '') + (x.morada ? ' · ' + esc(x.morada) : '') + '</span></div>' +
      '<label>Estado</label><div class="est-b">' + ESTADOS.map(function (s) { return '<button type="button" class="e-' + estClasse(s) + '" data-est="' + s + '" aria-pressed="' + (s === e) + '">' + s + '</button>'; }).join('') + '</div>' +
      '<div class="qa fabg">' + acts.map(function (a) { return '<button type="button" class="qbtn' + (a[0] === 'apagar' ? ' qdel' : '') + '" data-oac="' + a[0] + '">' + (a[0] === 'apagar' ? IC_DEL.replace('style="pointer-events:none"', '') : ICO[a[1]]) + '<span>' + a[2] + '</span></button>'; }).join('') + '</div>';
  }
  abrirDlg((x.cliente || 'Orçamento'), corpo(), []);
  $('dlg-b').onclick = function (ev) {
    var b = ev.target.closest('[data-est],[data-oac]'); if (!b) return;
    if (b.dataset.est) {
      var e = b.dataset.est; if (e === (x.estado || 'Por enviar')) return;
      mudarEstado(x, e); $('dlg-b').innerHTML = corpo();
      if (e === 'Aceite' && !obras.some(function (o) { return o.orcamentoId === x.id; })) toast('Aceite! Carregue em "Criar obra" para planear a obra.');
      else toast('Estado: ' + e + '.');
      return;
    }
    var a = b.dataset.oac;
    if (a === 'abrir') { fecharDlg(); abrirOrcForm(x, false); }
    else if (a === 'dup') { fecharDlg(); abrirOrcForm(x, true); }
    else if (a === 'obra') { fecharDlg(); criarObraDeOrc(x); }
    else if (a === 'cli') { fecharDlg(); abrirCliente(x.clienteId); }
    else if (a === 'apagar') {
      if (!confirm('Apagar o orçamento ' + x.num + (x.cliente ? ' de ' + x.cliente : '') + '? Não dá para desfazer.')) return;
      fecharDlg(); deleteDoc(doc(db, 'orcamentos', x.id)).catch(function (er) { falhou(er, 'apagar o orçamento'); });
      if (cur && cur.id === x.id) { cur.id = null; cur.num = null; toForm(cur); }
      toast('Orçamento apagado.');
    }
  };
}
['orc-todos', 'cf-orcs'].forEach(function (k) { $(k).addEventListener('click', function (e) { var b = e.target.closest('[data-orcx]'); if (b) dlgOrc(b.dataset.orcx); }); });
function renderOrcResumo() {
  var pend = orcs.filter(function (o) { return o.estado === 'Enviado' || o.estado === 'Por enviar' || !o.estado; });
  var ano = String(new Date().getFullYear()), ac = orcs.filter(function (o) { return (o.estado === 'Aceite' || o.estado === 'Concluído') && (o.data || '').slice(0, 4) === ano; });
  var env = orcs.filter(function (o) { return o.estado && o.estado !== 'Por enviar' && (o.data || '').slice(0, 4) === ano; }).length;
  var soma = function (l) { return l.reduce(function (a, o) { return a + (o.total || 0); }, 0); };
  $('orc-resumo').innerHTML = '<button type="button" class="ktile dest" data-fq="Enviado"><small>À espera de resposta</small><b>' + eur(soma(pend)) + '</b><span class="kt-s">' + pend.length + (pend.length === 1 ? ' orçamento' : ' orçamentos') + '</span></button>' +
    '<button type="button" class="ktile" data-fq="Aceite"><small>Aceites em ' + ano + '</small><b>' + eur(soma(ac)) + '</b><span class="kt-s">' + (env ? Math.round(ac.length / env * 100) + ' % dos enviados' : 'Ainda sem envios') + '</span></button>';
}
$('orc-resumo').addEventListener('click', function (e) { var b = e.target.closest('[data-fq]'); if (b) { filtroOrc = b.dataset.fq; renderOrcs(); } });

// ---------- ficha do orçamento: secções com resumo ----------
var Q_SECS = ['cliente', 'obra', 'med', 'mo', 'mat', 'desl', 'extras', 'iva'];
function estadoQ() {
  var f = cur.f, r = compute(cur), F = r.falta.join('|'), S = {};
  S.cliente = [f.c_nome ? f.c_nome + (f.o_morada ? ' · ' + cidade(f.o_morada) : '') : 'Escolha ou escreva o cliente', !!f.c_nome];
  S.obra = [[f.o_area ? f.o_area.replace('.', ',') + ' m²' : 'Sem área', f.modo === 'completa' ? 'Obra completa' : 'Só mão de obra', f.o_iso ? f.o_iso + (f.o_esp ? ' ' + f.o_esp + ' cm' : '') : ''].filter(Boolean).join(' · '), !/Área de fachada/.test(F)];
  var am = cur.medicao ? areaMed(cur.medicao) : 0;
  S.med = [am ? fmtN(am) + ' m² medidos' : 'Opcional · medir fachadas e vãos', am ? true : null];
  var mo = r.lines.find(function (l) { return /^Mão de obra/.test(l[0]); });
  S.mo = [mo ? eur(mo[1]) + ' · ' + mo[0].replace(/^Mão de obra:? ?/, '') : 'Falta o preço', !/mão de obra|Dias de trabalho/i.test(F)];
  var mat = r.lines.filter(function (l) { return /^Material|^Andaime/.test(l[0]); });
  S.mat = [mat.length ? eur(mat.reduce(function (a, l) { return a + l[1]; }, 0)) : 'Falta o preço do material', !/material/i.test(F)];
  var de = r.lines.find(function (l) { return /^Deslocações/.test(l[0]); });
  S.desl = [f.d_tipo === 'nao' ? 'Não cobrar' : de ? eur(de[1]) + ' · ' + de[0].replace(/^Deslocações:? ?/, '') : 'Faltam dados', f.d_tipo === 'nao' || !/deslocaç|carrinha|combustível|viagens/i.test(F)];
  var ex = (cur.extras || []).filter(function (x) { return num(x.v) > 0; });
  S.extras = [ex.length ? ex.length + (ex.length === 1 ? ' trabalho' : ' trabalhos') + ' · ' + eur(ex.reduce(function (a, x) { return a + num(x.v); }, 0)) : 'Nenhum (opcional)', /Valor de "/.test(F) ? false : (ex.length ? true : null)];
  S.iva = [(r.taxa ? 'IVA ' + r.taxa + ' %' : 'Sem IVA') + (f.validade ? ' · válido ' + f.validade + ' dias' : ''), true];
  return { S: S, r: r };
}
function resumoQ() {
  if (!cur || !cur.f) return;
  var q = estadoQ();
  if (vistaAtual === 'novo') cabecalho();
  Q_SECS.forEach(function (k) {
    var s = q.S[k], m = $('qs-' + k), ok = $('qk-' + k); if (!m) return;
    m.textContent = s[0];
    ok.className = 'qok ' + (s[1] === true ? 'q-ok' : s[1] === false ? 'q-falta' : 'q-op');
  });
  var r = q.r, f = cur.f;
  $('qh-total').textContent = eur(r.total);
  $('qh-cli').textContent = f.c_nome || 'Cliente por escolher';
  $('qh-sub').textContent = [f.o_area ? f.o_area.replace('.', ',') + ' m²' : '', r.area && r.base ? eur(r.base / r.area) + '/m² s/ IVA' : '', r.taxa ? 'IVA ' + r.taxa + ' %' : 'Sem IVA'].filter(Boolean).join(' · ');
  $('qh-num').textContent = cur.num ? 'N.º ' + cur.num : 'Novo orçamento';
  $('qh-est').textContent = cur.num ? (cur.estado || 'Por enviar') : 'Rascunho';
  $('qh-est').className = 'oh-est' + (cur.estado === 'Aceite' || cur.estado === 'Concluído' ? ' e-ok' : cur.estado === 'Enviado' ? ' e-warn' : '');
  var tot = Q_SECS.filter(function (k) { return k !== 'mat' || f.modo === 'completa'; }), feitos = tot.filter(function (k) { return q.S[k][1] !== false; }).length;
  $('qh-prog').style.width = Math.round(feitos / tot.length * 100) + '%';
  $('qh-falta').textContent = r.falta.length ? 'Falta: ' + r.falta.slice(0, 2).join(', ').toLowerCase() + (r.falta.length > 2 ? ' e mais ' + (r.falta.length - 2) : '') : 'Pronto para enviar';
}
function abrirSecsQ() {
  var q = estadoQ(), primeira = Q_SECS.find(function (k) { return q.S[k][1] === false && (k !== 'mat' || cur.f.modo === 'completa'); });
  document.querySelectorAll('#v-novo details[data-qsec]').forEach(function (d) { d.open = d.dataset.qsec === primeira; });
}
var calcBase = calc;
calc = function () { calcBase(); resumoQ(); };
var toFormBase = toForm;
toForm = function (q) { toFormBase(q); abrirSecsQ(); resumoQ(); };
$('qh-ver').addEventListener('click', function () { $('resumo').scrollIntoView({ behavior: 'smooth', block: 'start' }); });


// ---------- alterar um registo de dias ----------
function dlgEditDias(ids) {
  var regs = dias.filter(function (d) { return ids.indexOf(d.id) >= 0; });
  if (!regs.length) return;
  var r0 = regs[0], porPessoa = {};
  regs.forEach(function (d) { porPessoa[d.pessoa] = d; });
  var nomes = pessoas().slice(); Object.keys(porPessoa).forEach(function (n) { if (nomes.indexOf(n) < 0) nomes.push(n); });
  var corpo = '<div class="grid">' + campo('ed_data', 'Dia', r0.data, 'date') + campoSel('ed_obra', 'Obra', obrasOpts(r0.obraId || ''), r0.obraId || '') + '</div>' +
    '<label>Quem trabalhou</label><div class="ed-pess">' + nomes.map(function (n, i) {
      var d = porPessoa[n];
      return '<div class="ed-p"><label for="ep' + i + '"><input type="checkbox" id="ep' + i + '" data-ep="' + esc(n) + '"' + (d ? ' checked' : '') + '>' + esc(n) + '</label><select id="ef' + i + '" data-ef="' + esc(n) + '" aria-label="Tempo de ' + esc(n) + '">' + opts([['1', 'Dia inteiro'], ['0.5', 'Meio dia']], d && d.fracao === 0.5 ? '0.5' : '1') + '</select></div>';
    }).join('') + '</div>' + campo('ed_outro', 'Juntar outra pessoa (opcional)', '', 'text', ' placeholder="Nome de um ajudante"');
  abrirDlg('Alterar dia de trabalho', corpo, [
    { txt: 'Apagar registo', cls: 'danger', fn: function () { if (!confirm('Apagar este registo de dias?')) return false; regs.forEach(function (d) { deleteDoc(doc(db, 'dias', d.id)).catch(function (er) { falhou(er, 'apagar'); }); }); toast('Registo apagado.'); } },
    { txt: 'Guardar', cls: 'acc', fn: function () {
      var dt = val('ed_data') || r0.data, oid = val('ed_obra') || null, ob = oid && obras.find(function (x) { return x.id === oid; });
      var marc = {};
      document.querySelectorAll('#dlg-b [data-ep]').forEach(function (c) { if (c.checked) { var f = document.querySelector('#dlg-b [data-ef="' + CSS.escape(c.dataset.ep) + '"]'); marc[c.dataset.ep] = num(f.value) || 1; } });
      if (val('ed_outro')) marc[val('ed_outro')] = 1;
      if (!Object.keys(marc).length) { toast('Escolha quem trabalhou, ou apague o registo.'); return false; }
      var base = { data: dt, obraId: oid, obra: ob ? ob.nome : '', atualizadoEm: serverTimestamp(), atualizadoPor: porQuem() };
      regs.forEach(function (d) {
        if (marc[d.pessoa] == null) deleteDoc(doc(db, 'dias', d.id)).catch(function (er) { falhou(er, 'apagar'); });
        else updateDoc(doc(db, 'dias', d.id), Object.assign({ fracao: marc[d.pessoa] }, base)).catch(function (er) { falhou(er, 'guardar'); });
      });
      Object.keys(marc).forEach(function (n) { if (!porPessoa[n]) setDoc(doc(collection(db, 'dias')), Object.assign({ pessoa: n, fracao: marc[n], por: porQuem(), criadoEm: serverTimestamp() }, base)).catch(function (er) { falhou(er, 'guardar'); }); });
      toast('Dia de trabalho alterado.');
    } }
  ]);
}
$('obra-corpo').addEventListener('click', function (e) { var b = e.target.closest('[data-eddias]'); if (b) dlgEditDias(b.dataset.eddias.split(',')); });

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
