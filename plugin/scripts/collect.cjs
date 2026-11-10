// Resume los hilos de Claude Code (~/.claude/projects/*.jsonl) en un JSON compacto.
// Lo ejecuta el panel "Oficina" con node; guarda una caché por archivo (mtime + tamaño).
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const CLAUDE_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const CACHE_FILE = path.join(os.tmpdir(), 'oficina-de-chats-cache-v2.json');

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
const clean = t => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/g, '').replace(/\s+/g, ' ').trim();
const repoRoot = cwd => {
  if (!cwd) return null;
  const m = cwd.match(/^(.*?)[\\/](?:\.claude[\\/]worktrees|output[\\/]worktrees)[\\/]/i);
  return m ? m[1] : cwd;
};

function applyDelta(plan, inp) {
  if (inp.advance) {
    const i = plan.findIndex(p => p.status === 'in_progress');
    if (i >= 0) {
      plan[i].status = 'completed';
      const n = plan.findIndex((p, j) => j > i && p.status === 'pending');
      if (n >= 0) plan[n].status = 'in_progress';
    }
  }
  if (Array.isArray(inp.done)) inp.done.forEach(n => { if (plan[n - 1]) plan[n - 1].status = 'completed'; });
  if (typeof inp.start === 'number' && plan[inp.start - 1]) {
    plan.forEach(p => { if (p.status === 'in_progress') p.status = 'pending'; });
    plan[inp.start - 1].status = 'in_progress';
  }
}

async function parse(file) {
  const d = { id: path.basename(file, '.jsonl'), title: null, first: null, last: null, cwd: null, branch: null,
    created: null, updated: null, msgs: 0, plan: null, recap: null, ask: null, closed: false };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'custom-title' && o.customTitle) d.title = o.customTitle;
    if (o.type === 'summary' && o.summary && !d.title) d.title = o.summary;
    if (o.timestamp) { if (!d.created) d.created = o.timestamp; d.updated = o.timestamp; }
    if (o.cwd && !d.cwd) d.cwd = o.cwd;
    if (o.gitBranch) d.branch = o.gitBranch;
    if (o.isSidechain || !o.message) continue;
    const m = o.message;
    if (o.type === 'user' && m.role === 'user' && !o.isMeta) {
      const t = clean(textOf(m.content));
      if (t) { d.msgs++; if (!d.first) d.first = t.slice(0, 200); d.last = t.slice(0, 200); d.closed = false; }
    }
    if (o.type === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type !== 'tool_use') continue;
        const inp = c.input || {};
        if (c.name === 'mcp__ccd_turn__update_plan') {
          if (Array.isArray(inp.items)) d.plan = inp.items.map(i => ({ content: String(i.content), status: i.status }));
          else if (d.plan) applyDelta(d.plan, inp);
        } else if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) {
          d.plan = inp.todos.map(i => ({ content: String(i.content), status: i.status }));
        } else if (c.name === 'mcp__ccd_turn__wrap_up') {
          if (inp.recap) d.recap = inp.recap;
          d.ask = inp.ask || null;
          d.closed = true;
          if (d.plan) d.plan.forEach(p => { p.status = 'completed'; });
        }
      }
    }
  }
  return d;
}

(async () => {
  const out = [];
  const seen = {};
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true }).filter(e => e.isDirectory()); } catch {}
  for (const dir of dirs) {
    const full = path.join(CLAUDE_DIR, dir.name);
    let files = [];
    try { files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const p = path.join(full, f);
      let st; try { st = fs.statSync(p); } catch { continue; }
      const hit = cache[p];
      let d;
      if (hit && hit.m === st.mtimeMs && hit.s === st.size) d = hit.d;
      else { try { d = await parse(p); } catch { continue; } }
      seen[p] = { m: st.mtimeMs, s: st.size, d };
      if (!d.updated || !d.msgs) continue;
      const scratch = /AppData[\\/]/i.test(d.cwd || '') || /AppData/i.test(dir.name);
      const root = scratch ? '__borradores__' : (repoRoot(d.cwd) || dir.name);
      out.push({ ...d, project: root, projectName: scratch ? 'Borradores' : path.basename(root),
        worktree: d.cwd && repoRoot(d.cwd) !== d.cwd ? path.basename(d.cwd) : null });
    }
  }
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(seen)); } catch {}
  process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), threads: out }));
})();
