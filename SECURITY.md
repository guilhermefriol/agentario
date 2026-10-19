# Segurança

O Agentário é um painel local e somente leitura.

- O adaptador lê `~/.claude` sem escrever nada; só sai dele o nome da sala, nomes fictícios, rótulos de tarefa de uma lista fixa, timestamps e o veredito do Codex. Nenhum texto de transcript, caminho ou id de sessão.
- Adaptador e interface escutam só em `127.0.0.1` e conferem `Host`/`Origin`; o adaptador aceita apenas métodos de leitura.
- A única gravação é a decoração do modo edição, em `.agentario/decoracao.json` (fora do git), por uma rota que exige origem local, token anti-CSRF por processo, esquema validado, limite de 64 KB, backup e gravação atômica.
- `agentario.config.local.json` (lista real de projetos) nunca vai para o git; o hook de pre-commit roda o gitleaks e bloqueia esse arquivo.

Encontrou um problema? Abra uma issue sem incluir dados reais de projetos.
