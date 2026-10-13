import qrcode from './vendor/qrcode.mjs';

// Build passive SVG nodes from the QR matrix; never inject markup.
export function qrMatrix(text) {
 if (typeof text !== 'string' || text.length > 500) throw new Error('초대 링크를 확인해 주세요.');
 const code = qrcode(0, 'M');
 code.addData(text, 'Byte'); code.make();
 const size = code.getModuleCount();
 return Array.from({length:size}, (_, row) => Array.from({length:size}, (_, col) => code.isDark(row,col)));
}
export function createQR(text) {
 const matrix = qrMatrix(text), margin = 4, size = matrix.length + margin * 2;
 const ns = 'http://www.w3.org/2000/svg';
 const svg = document.createElementNS(ns, 'svg');
 svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
 svg.setAttribute('role','img'); svg.setAttribute('aria-label','합성 데모 초대 링크 QR 코드');
 svg.setAttribute('class','qr-code'); svg.setAttribute('shape-rendering','crispEdges');
 const background = document.createElementNS(ns,'rect');
 background.setAttribute('width',String(size)); background.setAttribute('height',String(size)); background.setAttribute('fill','#ffffff');
 svg.append(background);
 const path = document.createElementNS(ns,'path');
 let d = '';
 matrix.forEach((row,r) => row.forEach((dark,c) => { if(dark) d += 'M'+(c+margin)+' '+(r+margin)+'h1v1h-1z'; }));
 path.setAttribute('d',d); path.setAttribute('fill','#352f29'); svg.append(path);
 return svg;
}

