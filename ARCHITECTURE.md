# Arquitetura do Agentário

```
~/.claude (somente leitura)
   │  transcripts .jsonl, subagentes, .claude/agents/*.md
   ▼
server/claude-code/  ── adaptador (127.0.0.1:18790, WebSocket, só métodos de leitura)
   rooms.js     pasta de projeto ↔ cwd, agentes cadastrados (só `name`)
   tail.js      leitura incremental dos transcripts
   state.js     turnos → salas, sessões, funcionários, estagiários, Fiscal Codex, nomes russos
   watcher.js   descoberta + polling
   adapter.js   protocolo (agents.list, agentario.rooms, agentario.config, eventos chat/presence)
   │
   ▼
src/features/tv/  ── tela /tv (Next.js, navegador do Mac → TV pelo HDMI)
   useAgentarioFeed   conexão direta ao adaptador (reconexão, gerações)
   layout/            geradores: acesas | baias | andares (plantas por andar), encaixe na grade,
                      validação de navegação (mesma grade e A* da cena)
   movement.ts        quem vai para a mesa, lazer, visita ao Friol, espera
   floorTransit.ts    troca de andar pelo elevador
   demo.ts            modo demonstração
   decoration.ts      decoração/móveis/paredes da edição (+ rota /api/agentario/decoracao)
   TvEnvironment      pisos, placas, igreja, banheiro, auréola, bandeiras, elevadores
   │
   ▼
src/features/retro-office/  ── cena 3D (Claw3D, MIT) em modo dirigido:
   layout vindo de fora, alvo por personagem, câmera enquadrada, sem localStorage
```

## Decisões

- O painel é só leitura: nada é escrito em `~/.claude`. A única gravação é a decoração em
  `.agentario/decoracao.json` (fora do git).
- Nenhum texto livre de transcript sai do adaptador; tarefas são rótulos de uma lista fixa e
  obedecem à política `publico | interno | oculto` da sala.
- Tudo local: adaptador e interface em `127.0.0.1`, CSP sem CDN (HDRI e fonte servidos de
  `public/`).
- Layouts são funções puras testadas: todo lugar de toda planta é alcançável pelo A* da cena.

## Comandos

- `npm run tv` — adaptador + interface (dev); `npm run tv -- --prod` usa o build.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
