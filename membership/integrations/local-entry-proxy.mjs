import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
export function localEntryAllowed(method,path) {
 const route=path.split('?')[0];
 if(/^\/internal\//.test(route)||/\/webhooks?\//.test(route))return false;
 if(method==='GET'&&route==='/api/billing/orders')return true; // Local ledger list, not payment polling.
 if(/^\/api\/(?:orders?|refunds?|payments)(?:\/|$)/.test(route)||/^\/api\/(?:billing|commerce)\/(?:orders?|refunds?|redeem|checkout|pay|test-pay)(?:\/|$)/.test(route))return false;
 if(['GET','HEAD','OPTIONS'].includes(method))return true;
 return /^\/api\/auth(?:\/|$)/.test(route)||route==='/api/union-membership/events'||method==='POST'&&route==='/api/billing/welcome-seen'||/^(?:POST|PUT)$/.test(method)&&/^\/api\/(?:data|projects(?:\/[a-f0-9-]{36})?|me\/products(?:\/[a-zA-Z0-9_-]{1,128})?)$/.test(route);
}
export function createLocalEntryProxy({frontendPort,backendPort}) {
 const server=createServer((incoming,outgoing)=>{
  if(!localEntryAllowed(incoming.method,incoming.url)){outgoing.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});outgoing.end(JSON.stringify({error:{code:'LOCAL_ENTRY_ONLY',message:'本地联调仅开放入口、测试登录与任务保存，支付和 AI 调用关闭。'}}));return;}
  const port=incoming.url.startsWith('/api/')?backendPort:frontendPort;
  const request=httpRequest({hostname:'127.0.0.1',port,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:incoming.headers.host}},response=>{outgoing.writeHead(response.statusCode,{...response.headers,'x-zuoxue-local-integration':'entry-only'});response.pipe(outgoing);});
  request.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(503,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:{code:'LOCAL_PRODUCT_UNAVAILABLE',message:'本地产品正在启动，请稍后刷新'}}));});
  incoming.pipe(request);
 });
 server.on('upgrade',(request,socket,head)=>{
  const connection=connect(frontendPort,'127.0.0.1',()=>{connection.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(head.length)connection.write(head);socket.pipe(connection).pipe(socket);});
  connection.on('error',()=>socket.destroy());socket.on('error',()=>connection.destroy());
 });
 return server;
}
