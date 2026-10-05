const http = require('http');

const data = JSON.stringify({
  estudiante_id: 5,
  tipo_orden: 'preorden',
  momento_entrega: 'recreo_1',
  items: [{ producto_id: 8, cantidad: 1 }]
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3030,
  path: '/api/ordenes',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
