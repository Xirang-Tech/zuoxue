import { readFile } from 'node:fs/promises';
import { createMembershipServer } from './http.mjs';
import { createPreviewFixture } from './preview-fixture.mjs';
const catalog = JSON.parse(await readFile(new URL('../config/catalog.json',import.meta.url),'utf8'));
const preview = JSON.parse(await readFile(new URL('../config/preview.json',import.meta.url),'utf8'));
const config = { preview:true, origin:'http://127.0.0.1:5088', production:false, clients:{}, identity:{rpKey:'preview',publicOrigin:''}, experiment:{salesEnabled:false} };
const fixture = createPreviewFixture(catalog, preview);
const server = createMembershipServer({service:fixture.service,identity:fixture.identity,config,previewHandler:fixture.handle});
server.listen(5088,'127.0.0.1',() => console.log('佐学联合会员本地预览 http://127.0.0.1:5088'));
