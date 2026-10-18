# Agentário

Painel de TV que mostra projetos, agentes e skills do Claude Code como um escritório 3D animado.
Roda localmente no Mac e é exibido numa TV pelo HDMI.

Baseado no [Claw3D](https://github.com/iamlukethedev/Claw3D) (MIT), sem OpenClaw: a fonte de dados é o `~/.claude` local, lido somente em modo leitura.

> **Status:** funcionando — salas por projeto, 3 layouts, Friol, área de lazer, demonstração, modo noite e decoração.

## Rodando

```sh
npm install
npm run tv
```

Abra `http://localhost:3210/tv` no navegador do Mac (a TV é o monitor HDMI). O comando sobe o adaptador (`127.0.0.1:18790`, somente leitura) e a interface juntos; se um cair, o outro é derrubado. Para usar o build de produção: `npm run build && npm run tv -- --prod`.

O painel só aceita conexões da própria máquina; acesso por rede não é suportado.

## Na TV

| Ação | Como |
|---|---|
| Trocar layout | teclas **1** (só acesas), **2** (baias), **3** (andares), botões no canto ou `?layout=acesas\|baias\|andares` |
| Modo demonstração | clique no logo ou `?demo=1` (não fica salvo) |
| Cartão do personagem | clique no personagem (Esc fecha) |
| Modo edição (decoração) | tecla **E** ou botão "✎ Editar" |

- **Só acesas:** só as salas com trabalho aparecem; as apagadas ficam listadas embaixo.
- **Baias:** todas as salas em baias abertas.
- **Andares:** um andar por vez (troca a cada 20 s, priorizando os que têm sala acesa); a sala do Friol e o lazer ficam no **terraço**. Troca de andar pelo elevador.
- A decoração aceita só itens que não bloqueiam a passagem e fica em `.agentario/decoracao.json` (fora do git), gravada por uma rota que só aceita a própria máquina.

## Ideia

- **Salas:** cada pasta de `~/.claude/projects` vira uma sala (a sessão entra pela pasta onde roda, inclusive subpastas). Acende com trabalho; sala apagada fica vazia e quem estava nela vai para o lazer.
- **Personagens (nomes russos únicos):** sessões do Claude; funcionários (agentes de `<projeto>/.claude/agents`); estagiários (subagentes, chegam pela porta do centro); o **Fiscal Codex** aparece quando há `codex exec` com veredito.
- **Centro:** o Friol, numa mesa especial com auréola, recebe visitas curtas.
- **Lazer:** Academia, Banheiros, Refeitório, Sala de descanso e a *Igreja Adventista da I.A. dos Últimos Dias*. Até 50% dos parados de salas acesas vão "matar o tempo" nelas (troca a cada 4 min); quem não couber fica na área de espera.
- **Modo demonstração:** clique no logo ou `?demo=1` (não fica salvo).
- **Modo noite** configurável.

## Configuração local

```sh
cp agentario.config.example.json agentario.config.local.json
```

O `agentario.config.local.json` contém a lista real de projetos e **nunca** é versionado (`.gitignore` + hook de pre-commit).

| Campo | Efeito |
|---|---|
| `layout` | layout padrão (`acesas`, `baias`, `andares`) |
| `night` | modo noite: `{ "enabled": true, "from": "22:00", "to": "07:00" }` |
| `exclude` | expressões que escondem pastas (ex.: backups) |
| `projects.<pasta>.label` | nome exibido |
| `projects.<pasta>.hidden` | some do painel |
| `projects.<pasta>.tasks` | `publico` (rótulo da tarefa), `interno` ("Trabalhando"), `oculto` (nada); inválido → oculto |
| `showRealNames` | `false` troca os nomes das pastas por "Sala N" |

## Segurança

- Servidor só em `127.0.0.1`; o painel é somente leitura.
- Hook de pre-commit com [gitleaks](https://github.com/gitleaks/gitleaks), ativado com `git config core.hooksPath .githooks`.

## Licença

MIT. Veja `LICENSE` e `NOTICE.md`.
