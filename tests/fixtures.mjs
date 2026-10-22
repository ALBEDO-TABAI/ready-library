import { zipSync, strToU8 } from 'fflate';

export function epub() {
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<package xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Windows 阅读验证</dc:title><dc:creator>Ready Library</dc:creator><dc:language>zh</dc:language></metadata><manifest>${[1, 2, 3].map((n) => `<item id="c${n}" href="chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${[1, 2, 3].map((n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`),
    'OEBPS/nav.xhtml': strToU8(`<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${[1, 2, 3].map((n) => `<li><a href="chapter${n}.xhtml">第${n}章 验证阅读</a></li>`).join('')}</ol></nav></body></html>`),
  };
  for (const n of [1, 2, 3]) files[`OEBPS/chapter${n}.xhtml`] = strToU8(`<html><body><h1>第${n}章 验证阅读</h1>${Array.from({ length: 18 }, (_, i) => `<p>这是第${n}章第${i + 1}段。${'窗外的阳光照进书房，书架上的每一本书都有自己的故事。阅读时可以翻页、添加书签，也可以选中文字留下批注。'.repeat(4)}</p>`).join('')}</body></html>`);
  return Buffer.from(zipSync(files));
}

export const gbk = Buffer.from('b5dad2bbd5c20d0ad6d0cec4b2e2cad40d0a', 'hex');

export function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const stream = 'BT /F1 20 Tf 30 350 Td (Windows PDF test) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const second = 'BT /F1 20 Tf 30 350 Td (Windows PDF page two) Tj ET';
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${second.length} >>\nstream\n${second}\nendstream`);
  let out = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
