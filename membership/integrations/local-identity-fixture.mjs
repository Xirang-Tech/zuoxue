import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
export const LOCAL_TEST_USERS = Object.freeze([
 {centralUserId:'00000000-0000-4000-8000-00000000000a',email:'union-a@example.test',username:'联合会员测试 A',phone:'+8613800000001'},
 {centralUserId:'00000000-0000-4000-8000-00000000000b',email:'union-b@example.test',username:'联合会员测试 B',phone:'+8613800000002'},
]);
export const LOCAL_TEST_PASSWORD='LocalUnion2026!';
export function createLocalIdentityFixture(token) {
 const epochs=new Map(LOCAL_TEST_USERS.map(user=>[user.centralUserId,0]));
 return createServer(async(request,response)=>{
  const send=(status,body)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({requestId:'local-identity-fixture',...body}));};
  const supplied=Buffer.from(String(request.headers['x-internal-token']||'')),expected=Buffer.from(token);
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return send(401,{error:{code:'invalid_token',message:'本地身份模拟需要内部凭证'}});
  let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>16000)return send(413,{error:{code:'invalid_request'}});}
  let body;try{body=raw?JSON.parse(raw):{};}catch{return send(400,{error:{code:'invalid_request'}});}
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(path==='/internal/auth/login'){
   const user=LOCAL_TEST_USERS.find(user=>[user.email,user.phone,user.phone.slice(3)].includes(body.identifier));
   if(!user || body.password!==LOCAL_TEST_PASSWORD)return send(401,{status:'error',error:{code:'invalid_credentials',message:'请使用本地测试账号与演示密码'}});
   return send(200,{status:'ok',centralUserId:user.centralUserId,user:{...user,avatarUrl:null,emailVerified:true,phoneVerified:true,status:'ACTIVE',createdVia:'local-fixture',passwordResetRequired:false},sessionEpoch:epochs.get(user.centralUserId)});
  }
  const epoch=/^\/internal\/users\/([^/]+)\/session-epoch$/.exec(path);
  if(epoch && epochs.has(epoch[1]))return send(200,{status:'ok',sessionEpoch:epochs.get(epoch[1])});
  if(path==='/internal/users/link-rp-user')return send(200,{status:'ok'});
  if(path==='/internal/sessions/revoke' && epochs.has(body.centralUserId)){epochs.set(body.centralUserId,epochs.get(body.centralUserId)+1);return send(200,{status:'ok',sessionEpoch:epochs.get(body.centralUserId),revokedSessions:0});}
  return send(404,{error:{code:'not_found',message:'本地身份模拟仅提供登录与会话校验'}});
 });
}
