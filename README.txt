ORION HOME + SUPABASE

Projeto configurado com o Supabase informado.

USUARIOS CONFIGURADOS
CASA:
- orionhouse@gmail.com

RUA:
- hummelgen17@gmail.com
- kaylaine.carol02@gmail.com

PASSO 1 - EXECUTAR O SQL
No Supabase abra:
SQL Editor > New query

Cole TODO o conteudo do arquivo SUPABASE-SETUP.sql e clique em Run.
Esse SQL associa os tres usuarios existentes aos acessos Casa/Rua.

PASSO 2 - LOGIN
Acesso Casa:
- selecione Casa
- pode digitar "casa" ou orionhouse@gmail.com
- use a senha cadastrada no Supabase

Acesso Rua:
- selecione Rua
- entre com hummelgen17@gmail.com OU kaylaine.carol02@gmail.com
- use a senha correspondente

PASSO 3 - PUBLICAR EM HTTPS
Para o microfone funcionar corretamente fora do localhost, publique o projeto em HTTPS.
Pode usar GitHub Pages, Hostinger, Netlify ou Vercel.

PERMISSOES
- Casa: voz, adicionar, excluir, limpar e marcar itens.
- Rua: visualizar a lista e marcar/desmarcar itens comprados.
- Todos compartilham a mesma lista sincronizada pelo Supabase em tempo real.

SEGURANCA
A chave presente no app.js e apenas a Publishable Key.
Nunca coloque service_role ou secret key no frontend.
