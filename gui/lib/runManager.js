const { spawn } = require('child_process');

// Matches the exact stdout format index.js writes per dealer:
// "[3/50] Some Dealership (City) ... SUBMITTED  — optional notes"
const BOT_LINE_RE = /^\[(\d+)\/(\d+)\]\s+(.*?)\s+\(([^)]*)\)\s+\.\.\.\s+(\S+)(?:\s+—\s+(.*))?$/;
const MAX_BUFFER_LINES = 3000;

class RunManager {
  constructor() {
    this.child = null;
    this.buffer = [];
    this.clients = new Set();
    this.state = this._idleState();
  }

  _idleState() {
    return {
      active: false,
      type: null,
      label: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      currentIndex: 0,
      totalRows: 0,
      counts: {},
    };
  }

  isActive() {
    return this.state.active;
  }

  getStatus() {
    return { ...this.state, counts: { ...this.state.counts } };
  }

  start({ type, label, command, args, cwd, env }) {
    if (this.state.active) {
      const err = new Error('A job is already running — stop it first.');
      err.code = 'ALREADY_RUNNING';
      throw err;
    }

    this.buffer = [];
    this.state = {
      ...this._idleState(),
      active: true,
      type,
      label,
      startedAt: new Date().toISOString(),
    };

    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    this.child = child;

    // index.js writes each dealer's progress as TWO stdout writes: a bare
    // process.stdout.write(...) with no trailing newline, then console.log(status)
    // finishing the line. Buffer partial lines across chunks (per stream) instead of
    // treating each data event in isolation, or that pair never recombines into one
    // matchable "[i/n] Name (City) ... STATUS" line.
    this._pending = { stdout: '', stderr: '' };

    const onData = (streamName) => (chunk) => {
      this._pending[streamName] += chunk.toString('utf8');
      const parts = this._pending[streamName].split(/\r?\n/);
      this._pending[streamName] = parts.pop();
      for (const line of parts) {
        if (line.length > 0) this._handleLine(line, streamName);
      }
    };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    child.on('error', (err) => {
      this._handleLine(`[process error] ${err.message}`, 'stderr');
    });

    child.on('close', (code) => {
      for (const streamName of ['stdout', 'stderr']) {
        if (this._pending[streamName]) {
          this._handleLine(this._pending[streamName], streamName);
          this._pending[streamName] = '';
        }
      }
      this.state.active = false;
      this.state.exitCode = code;
      this.state.finishedAt = new Date().toISOString();
      this.child = null;
      this._broadcast('state', this.getStatus());
      this._broadcast('done', { exitCode: code, counts: this.state.counts });
    });

    this._broadcast('state', this.getStatus());
    return this.getStatus();
  }

  stop() {
    if (!this.child) return false;
    const child = this.child;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL');
    }, 5000);
    return true;
  }

  _handleLine(line, stream) {
    this.buffer.push({ line, stream });
    if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift();
    this._broadcast('log', { line, stream });

    const match = BOT_LINE_RE.exec(line);
    if (match) {
      const [, idx, total, , , status] = match;
      this.state.currentIndex = Number(idx);
      this.state.totalRows = Number(total);
      this.state.counts[status] = (this.state.counts[status] || 0) + 1;
      this._broadcast('state', this.getStatus());
    }
  }

  // Replays the buffered log + current state to a (re)connecting SSE client,
  // so a page refresh mid-run reattaches instead of losing history.
  subscribe(res) {
    this.clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(this.getStatus())}\n\n`);
    for (const { line, stream } of this.buffer) {
      res.write(`event: log\ndata: ${JSON.stringify({ line, stream })}\n\n`);
    }
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch {}
    }, 20000);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  _broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try { res.write(payload); } catch {}
    }
  }
}

module.exports = new RunManager();
