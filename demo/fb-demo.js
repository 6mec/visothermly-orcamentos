// VisoThermLy · versão de teste: base de dados falsa guardada só neste aparelho
const KEY = 'vt-demo-v1';
const H = n => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
function exemplo() {
  const S = {};
  S['membros/u1'] = { nome: 'Daniel (teste)', email: 'teste@visothermly.pt', telefone: '967 250 612', codigo: 'VT-4SA4QK' };
  S['membros/u2'] = { nome: 'André' }; S['membros/u3'] = { nome: 'Yuri' }; S['membros/u4'] = { nome: 'Ismael' };
  S['config/geral'] = { s_nome: 'VisoThermLy', s_resp: 'André Araújo', s_tel: '969 251 726', s_validade: '30', s_iva: '0' };
  S['clientes/c1'] = { nome: 'Maria Costa', telefone: '912345678', morada: 'Rua das Flores 12, Viseu', nif: '234567890', email: 'maria@exemplo.pt' };
  S['clientes/c2'] = { nome: 'José Ferreira', telefone: '913222111', morada: 'Av. da Europa 40, Mangualde' };
  S['clientes/c3'] = { nome: 'Ana Lopes', telefone: '915000111', morada: 'Rua do Castelo 3, Tondela' };
  const f1 = { c_nome: 'Maria Costa', c_tel: '912345678', o_morada: 'Rua das Flores 12, Viseu', modo: 'mo', o_area: '160', o_iso: 'EPS grafite', o_esp: '6', mo_tipo: 'm2', mo_preco: '16', mo_rend: '20', d_tipo: 'calc', d_km: '30', d_cons: '9', d_comb: '1,65', iva: '0', validade: '30', o_desc: 'Aplicação de sistema de isolamento térmico pelo exterior (capoto / ETICS) na fachada.' };
  S['orcamentos/o1'] = { num: '2026/001', data: H(-12), estado: 'Aceite', clienteId: 'c1', cliente: 'Maria Costa', morada: f1.o_morada, total: 2671.28, f: f1, extras: [] };
  S['orcamentos/o2'] = { num: '2026/002', data: H(-9), estado: 'Enviado', enviadoEm: H(-9), clienteId: 'c2', cliente: 'José Ferreira', morada: 'Av. da Europa 40, Mangualde', total: 8900, f: { c_nome: 'José Ferreira', o_area: '420', mo_tipo: 'm2', mo_preco: '20', d_tipo: 'nao', modo: 'mo' }, extras: [{ d: 'Reparação de fissuras', v: '500' }] };
  S['orcamentos/o3'] = { num: '2026/003', data: H(-2), estado: 'Aceite', clienteId: 'c3', cliente: 'Ana Lopes', morada: 'Rua do Castelo 3, Tondela', total: 5200, f: { c_nome: 'Ana Lopes', o_area: '260', mo_tipo: 'm2', mo_preco: '20', d_tipo: 'nao', modo: 'mo' }, extras: [] };
  S['obras/b1'] = { nome: 'Moradia Maria Costa', clienteId: 'c1', cliente: 'Maria Costa', telefone: '912345678', morada: 'Rua das Flores 12, Viseu', orcamentoId: 'o1', orcNum: '2026/001', valor: 2671.28, area: '160', iso: 'EPS grafite', esp: '6', estado: 'Em curso', inicio: H(-3), fim: H(9), equipa: ['André', 'Yuri', 'Ismael'], fases: { suporte: { f: true, d: H(-3), por: 'André' }, arranque: { f: true, d: H(-2), por: 'Yuri' }, colagem: { f: true, d: H(-1), por: 'Ismael' } }, plano: [{ d: 'Adjudicação', v: 800, q: 'inicio' }, { d: 'A meio da obra', v: 1071.28, q: 'barramento' }, { d: 'Final', v: 800, q: 'fim' }] };
  S['clientes/c1/pagamentos/p1'] = { data: H(-3), valor: 800, descricao: 'Adjudicação', obraId: 'b1', por: 'André' };
  S['pedidos/pd1'] = { nome: 'Carlos Lopes', telefone: '913111222', morada: 'Rua Nova 5, Nelas', estado: 'Visita marcada', visita: H(1), hora: '10:00', data: H(-1), origem: 'Telefone', descricao: 'Moradia de 2 pisos' };
  S['pedidos/pd2'] = { nome: 'Rita Sousa', telefone: '914555666', estado: 'Novo', data: H(-3), origem: 'WhatsApp' };
  S['despesas/d1'] = { data: H(-2), valor: 65.4, categoria: 'Combustível', descricao: 'Gasóleo carrinha', obraId: 'b1', obra: 'Moradia Maria Costa', por: 'André' };
  S['dias/x1'] = { data: H(-3), pessoa: 'André', fracao: 1, obraId: 'b1', obra: 'Moradia Maria Costa' };
  S['dias/x2'] = { data: H(-3), pessoa: 'Yuri', fracao: 1, obraId: 'b1', obra: 'Moradia Maria Costa' };
  S['dias/x3'] = { data: H(-3), pessoa: 'Ismael', fracao: 1, obraId: 'b1', obra: 'Moradia Maria Costa' };
  S['documentos/k1'] = { nome: 'Seguro de acidentes de trabalho', validade: H(20) };
  return S;
}
let store;
try { if (location.search.indexOf('repor') >= 0) localStorage.removeItem(KEY); store = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
if (!store) store = exemplo();
window.__store = store;
function guardar() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* espaço cheio: fica só em memória */ } }
const listeners = [];
let idc = 0;
const nid = () => 'id' + Date.now().toString(36) + (++idc) + Math.random().toString(36).slice(2, 6);
function notify() { guardar(); listeners.slice().forEach(l => l.fire()); }
function colDocs(path) {
  const pre = path + '/';
  return Object.keys(store).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ id: k.slice(pre.length), data: () => JSON.parse(JSON.stringify(store[k])) }));
}
export function initializeApp(c) { return { c }; }
export function getAuth() { return {}; }
export function onAuthStateChanged(a, cb) { setTimeout(() => cb({ uid: 'u1', email: 'teste@visothermly.pt' }), 10); }
export async function signInWithEmailAndPassword() {}
export async function createUserWithEmailAndPassword() {}
export async function sendPasswordResetEmail() {}
export async function signOut() { if (confirm('Repor os dados de exemplo da versão de teste?')) { localStorage.removeItem(KEY); location.reload(); } }
export function initializeFirestore() { return { db: 1 }; }
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function collection(db, ...p) { return { kind: 'col', path: p.join('/') }; }
export function doc(a, ...p) {
  if (a.kind === 'col') { const path = a.path + '/' + (p[0] || nid()); return { kind: 'doc', path, id: path.split('/').pop() }; }
  const path = p.join('/');
  return { kind: 'doc', path, id: path.split('/').pop() };
}
export function query(r) { return r; }
export function orderBy() { return null; }
export function where() { return null; }
export function serverTimestamp() { return new Date().toISOString(); }
export async function setDoc(r, d, o) { store[r.path] = o && o.merge ? Object.assign({}, store[r.path] || {}, JSON.parse(JSON.stringify(d))) : JSON.parse(JSON.stringify(d)); notify(); }
export async function updateDoc(r, d) { if (!store[r.path]) throw Object.assign(new Error('no doc'), { code: 'not-found' }); Object.assign(store[r.path], JSON.parse(JSON.stringify(d))); notify(); }
export async function deleteDoc(r) { delete store[r.path]; notify(); }
export async function getDoc(r) { const v = store[r.path]; return { exists: () => !!v, data: () => v && JSON.parse(JSON.stringify(v)), id: r.id }; }
export async function getDocs(r) { return { docs: colDocs(r.path) }; }
export async function runTransaction(db, fn) { return fn({ get: getDoc, set: (r, d, o) => setDoc(r, d, o), update: (r, d) => updateDoc(r, d) }); }
export function onSnapshot(r, cb) {
  const l = { fire: () => { if (r.kind === 'doc') { const v = store[r.path]; cb({ exists: () => !!v, data: () => v && JSON.parse(JSON.stringify(v)), id: r.id }); } else cb({ docs: colDocs(r.path) }); } };
  listeners.push(l); setTimeout(l.fire, 0);
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}
export function getStorage() { return {}; }
export function ref(s, p) { return { path: p }; }
export function uploadBytesResumable() { throw new Error('sem armazenamento'); }
export async function getDownloadURL() { return ''; }
export async function deleteObject() {}
