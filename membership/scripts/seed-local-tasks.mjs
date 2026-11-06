import assert from 'node:assert/strict';
import { LOCAL_TEST_USERS, LOCAL_TEST_PASSWORD } from '../integrations/local-identity-fixture.mjs';
// Synthetic local B account only. This creates a blank document, never model output.
const origin='http://127.0.0.1:5102';
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({identifier:LOCAL_TEST_USERS[1].email,password:LOCAL_TEST_PASSWORD})});
assert.equal(login.status,200);const {user}=await login.json();
const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const response=await fetch(origin+'/api/data',{headers:{cookie}});assert.equal(response.status,200);
const {data,version}=await response.json();const document=data||{profile:{},settings:{},cases:[],jds:[],plans:[]};
const id='union-local-return-project';
if(!document.plans.some(plan=>plan.id===id)){
 const now=Date.now();
 document.plans.push({id,kind:'jd',step:'input',jdText:'本地联合会员入口测试，不调用模型。',jdCompany:'联调演示',jdPosition:'产品经理',resumeAnalysis:null,jdInsight:null,directions:[],selectedDirectionIds:[],designs:[],drill:[],drillSummaries:[],inputRevision:1,artifacts:{},createdAt:now,updatedAt:now,ideaFollowUps:[]});
 const saved=await fetch(origin+'/api/data',{method:'PUT',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({data:document,expectedVersion:version,ownerId:user.id})});assert.equal(saved.status,200);
}
console.log(origin+'/#project/'+id);
