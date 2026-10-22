// A deterministic stand-in for the CLI; no account, network, or real downloads.
import { basename, join } from 'node:path';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(1);
const cmd = basename(args[0] || '');
if (process.env.FAKE_ZLIB_MODE === 'unauthorized' && cmd !== 'version') {
  process.stderr.write('login required'); process.exit(3);
}
if (cmd === 'version') { console.log('zlib test'); process.exit(0); }
if (cmd === 'profile') { console.log(JSON.stringify({ quota_known: true, daily_remaining: 5, daily_allowed: 10 })); process.exit(0); }
if (cmd === 'search') {
  const bytes = Buffer.from(JSON.stringify({ books: [{ id: '42:hash', name: '中文检索', authors: ['测试作者'], extension: 'EPUB' }], page: 1, total_pages: 1 }));
  const cut = bytes.indexOf(Buffer.from('中')) + 1;
  process.stdout.write(bytes.subarray(0, cut));
  await new Promise(() => setTimeout(() => { process.stdout.write(bytes.subarray(cut), () => process.exit(0)); }, 30));
} else if (cmd === 'download') {
  const dir = args[args.indexOf('--dir') + 1];
  if (process.env.FAKE_ZLIB_MODE === 'slow') {
    writeFileSync(join(dir, 'started'), String(process.pid));
    await new Promise(() => setInterval(() => process.stderr.write('10%\n'), 100));
  } else {
    const path = join(dir, '中文 & 空格.txt');
    writeFileSync(path, '第一章\r\n测试下载');
    console.log(JSON.stringify({ path })); process.exit(0);
  }
} else { process.exit(2); }
