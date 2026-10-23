(function () {
  'use strict';

  // ---------- armazenamento ----------
  var K_SET = 'vt-definicoes', K_LIST = 'vt-orcamentos', K_DRAFT = 'vt-rascunho';
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Não foi possível guardar neste telemóvel.'); return false; } }

  var SET_FIELDS = ['s_nome', 's_resp', 's_nif', 's_tel', 's_email', 's_morada', 's_isencao', 's_rend', 's_cons', 's_validade', 's_iva', 's_num', 's_desc', 's_cond'];
  var DEF_SET = { s_nome: 'VisoThermLy', s_num: '1', s_iva: '0', s_desc: 'Aplicação de sistema de isolamento térmico pelo exterior (capoto / ETICS) na fachada.' };
  var Q_FIELDS = ['c_nome', 'c_tel', 'c_nif', 'o_morada', 'modo', 'o_area', 'o_iso', 'o_esp', 'o_desc', 'mo_tipo', 'mo_preco', 'mo_rend', 'mo_dias', 'm_mat', 'm_and', 'm_margem', 'd_tipo', 'd_km', 'd_viagens', 'd_cons', 'd_comb', 'd_port', 'd_valor', 'iva', 'validade', 'condicoes', 'notas'];

  var settings = Object.assign({}, DEF_SET, load(K_SET, {}));
  var list = load(K_LIST, []);
  var cur = null; // orçamento aberto
  var dirty = false;

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

  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600); }

  // ---------- navegação ----------
  function show(v) {
    ['novo', 'lista', 'def'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('nav button').forEach(function (b) { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (v === 'lista') renderList();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.v); }); });

  // ---------- orçamento ----------
  function blankQuote() {
    var f = {};
    Q_FIELDS.forEach(function (k) { f[k] = ''; });
    f.modo = 'mo'; f.mo_tipo = 'm2'; f.d_tipo = 'calc'; f.o_iso = '';
    f.o_desc = settings.s_desc || '';
    f.mo_rend = settings.s_rend || '';
    f.d_cons = settings.s_cons || '';
    f.iva = settings.s_iva || '0';
    f.validade = settings.s_validade || '';
    f.condicoes = settings.s_cond || '';
    return { id: null, num: null, data: null, estado: 'Por enviar', f: f, extras: [] };
  }

  function toForm(q) {
    Q_FIELDS.forEach(function (k) { $(k).value = q.f[k] == null ? '' : q.f[k]; });
    renderExtras();
    $('q-num').textContent = q.num ? 'Orçamento n.º ' + q.num : 'Novo orçamento';
    $('q-info').textContent = q.num ? (q.estado + ' · criado a ' + dataPT(q.data)) : 'Ainda não guardado';
    calc();
  }
  function fromForm() { Q_FIELDS.forEach(function (k) { cur.f[k] = $(k).value; }); }

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

  function changed() { dirty = true; fromForm(); calc(); save(K_DRAFT, { q: cur, dirty: dirty }); }
  Q_FIELDS.forEach(function (k) { $(k).addEventListener('input', changed); $(k).addEventListener('change', changed); });

  function guardar() {
    fromForm();
    var r = compute(cur);
    if (!cur.id) {
      var n = parseInt(settings.s_num, 10) || 1;
      cur.id = String(Date.now());
      cur.num = new Date().getFullYear() + '/' + String(n).padStart(3, '0');
      cur.data = hoje();
      settings.s_num = String(n + 1); save(K_SET, settings); $('s_num').value = settings.s_num;
    }
    cur.total = r.total; cur.cliente = cur.f.c_nome; cur.morada = cur.f.o_morada; cur.atualizado = hoje();
    var copy = JSON.parse(JSON.stringify(cur));
    var i = list.findIndex(function (x) { return x.id === cur.id; });
    if (i >= 0) list[i] = copy; else list.unshift(copy);
    if (save(K_LIST, list)) { dirty = false; save(K_DRAFT, { q: cur, dirty: false }); toForm(cur); toast('Orçamento ' + cur.num + ' guardado.'); }
  }
  $('b-guardar').addEventListener('click', guardar);

  $('b-novo').addEventListener('click', function () {
    if (dirty && !confirm('Este orçamento tem alterações por guardar. Começar um novo na mesma?')) return;
    cur = blankQuote(); dirty = false; save(K_DRAFT, { q: cur, dirty: false }); toForm(cur); window.scrollTo(0, 0);
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
    if (!cur.id) guardar();
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
  $('b-pdf').addEventListener('click', function () { gerarPDF().catch(function (e) { console.error(e); toast('Não foi possível gerar o PDF.'); }); });

  // ---------- lista ----------
  var ESTADOS = ['Por enviar', 'Enviado', 'Aceite', 'Recusado', 'Concluído'];
  function renderList() {
    var q = ($('filtro').value || '').toLowerCase();
    var items = list.filter(function (x) { return !q || ((x.cliente || '') + ' ' + (x.morada || '') + ' ' + x.num).toLowerCase().indexOf(q) >= 0; });
    if (!items.length) { $('lista').innerHTML = '<p class="empty">' + (list.length ? 'Nenhum orçamento encontrado.' : 'Ainda não há orçamentos guardados. Preencha um no separador Orçamento e carregue em Guardar.') + '</p>'; return; }
    $('lista').innerHTML = items.map(function (x) {
      return '<div class="item"><div class="item-top"><b>' + esc(x.cliente || 'Sem nome') + '</b><span>' + eur(x.total) + '</span></div>' +
        '<div class="meta">N.º ' + esc(x.num) + ' · ' + dataPT(x.data) + (x.morada ? ' · ' + esc(x.morada) : '') + '</div>' +
        '<div class="row" style="align-items:center"><label for="st' + x.id + '" style="flex:1 1 140px">Estado<select id="st' + x.id + '" data-st="' + x.id + '">' +
        ESTADOS.map(function (e) { return '<option' + (e === x.estado ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="btn small" data-open="' + x.id + '">Abrir</button>' +
        '<button type="button" class="btn ghost small" data-dup="' + x.id + '">Duplicar</button>' +
        '<button type="button" class="btn danger small" data-rm="' + x.id + '">Apagar</button></div></div>';
    }).join('');
  }
  $('filtro').addEventListener('input', renderList);
  function byId(id) { return list.find(function (x) { return x.id === id; }); }
  $('lista').addEventListener('change', function (e) {
    var id = e.target.dataset.st; if (!id) return;
    var x = byId(id); x.estado = e.target.value; save(K_LIST, list);
    if (cur.id === id) { cur.estado = x.estado; toForm(cur); }
    toast('Estado atualizado.');
  });
  $('lista').addEventListener('click', function (e) {
    var d = e.target.dataset, x;
    if (d.open || d.dup) {
      if (dirty && !confirm('O orçamento aberto tem alterações por guardar. Continuar na mesma?')) return;
      x = JSON.parse(JSON.stringify(byId(d.open || d.dup)));
      if (d.dup) { x.id = null; x.num = null; x.data = null; x.estado = 'Por enviar'; }
      cur = x; dirty = !!d.dup; save(K_DRAFT, { q: cur, dirty: dirty }); toForm(cur); show('novo');
      if (d.dup) toast('Cópia criada. Altere o que precisar e guarde.');
    } else if (d.rm) {
      x = byId(d.rm);
      if (!confirm('Apagar o orçamento ' + x.num + (x.cliente ? ' de ' + x.cliente : '') + '? Não dá para desfazer.')) return;
      list = list.filter(function (y) { return y.id !== d.rm; }); save(K_LIST, list);
      if (cur.id === d.rm) { cur.id = null; cur.num = null; toForm(cur); }
      renderList(); toast('Orçamento apagado.');
    }
  });

  // ---------- definições ----------
  SET_FIELDS.forEach(function (k) {
    $(k).value = settings[k] == null ? '' : settings[k];
    $(k).addEventListener('input', function () { settings[k] = $(k).value; save(K_SET, settings); });
    $(k).addEventListener('change', function () { settings[k] = $(k).value; save(K_SET, settings); });
  });

  $('b-export').addEventListener('click', function () {
    var data = JSON.stringify({ app: 'visothermly-orcamentos', versao: 1, data: hoje(), definicoes: settings, orcamentos: list }, null, 1);
    entregar(new Blob([data], { type: 'application/json' }), 'copia-orcamentos-' + hoje() + '.json');
  });
  $('f-import').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (d.app !== 'visothermly-orcamentos' || !Array.isArray(d.orcamentos)) throw new Error('formato');
        if (!confirm('Recuperar ' + d.orcamentos.length + ' orçamentos desta cópia? Os orçamentos com o mesmo número são substituídos, os outros ficam.')) return;
        d.orcamentos.forEach(function (o) { var i = list.findIndex(function (x) { return x.id === o.id; }); if (i >= 0) list[i] = o; else list.push(o); });
        list.sort(function (a, b) { return (b.id || '').localeCompare(a.id || ''); });
        save(K_LIST, list);
        if (d.definicoes) { settings = Object.assign({}, settings, d.definicoes); save(K_SET, settings); SET_FIELDS.forEach(function (k) { $(k).value = settings[k] == null ? '' : settings[k]; }); }
        toast('Cópia recuperada.');
      } catch (err) { toast('Este ficheiro não é uma cópia de segurança desta app.'); }
      e.target.value = '';
    };
    rd.readAsText(file);
  });

  // ---------- arranque ----------
  var draft = load(K_DRAFT, null);
  if (draft && draft.q && draft.q.f) { cur = draft.q; if (!cur.extras) cur.extras = []; dirty = !!draft.dirty; }
  else cur = blankQuote();
  toForm(cur);

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
})();
