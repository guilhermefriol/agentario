# Agentário

Painel de TV que mostra projetos, agentes e skills do Claude Code como um escritório 3D animado.
Roda localmente no Mac e é exibido numa TV pelo HDMI.

Baseado no [Claw3D](https://github.com/iamlukethedev/Claw3D) (MIT), sem OpenClaw: a fonte de dados é o `~/.claude` local, lido somente em modo leitura.

> **Status:** funcionando — um andar com todas as salas, Friol, área de lazer, demonstração, modo noite e decoração.

## Rodando

```sh
npm install
npm run tv
```

Abra `http://localhost:3210/tv` no navegador do Mac (a TV é o monitor HDMI). O comando sobe o adaptador (`127.0.0.1:18790`, somente leitura) e a interface juntos; se um cair, o outro é derrubado. Para usar o build de produção: `npm run build && npm run tv -- --prod`.

O painel só aceita conexões da própria máquina; acesso por rede não é suportado.

### Subir sozinho no login

```sh
scripts/install-kiosk.sh --dry-run   # só gera e valida o LaunchAgent
scripts/install-kiosk.sh             # build + instala o painel (sem sudo)
scripts/uninstall-kiosk.sh           # desfaz
```

Instala o LaunchAgent do usuário `com.agentario.tv` (painel em produção; reinicia se cair, com intervalo de 30 s). Abra `http://localhost:3210/tv` no navegador. Opcional: `--kiosk` também abre a `/tv` em tela cheia num navegador Chromium (Google Chrome, Chromium, Brave ou Edge) com perfil separado. Logs em `~/Library/Logs/agentario/`. A página se recarrega sozinha se o WebGL cair e todo dia às 04:00.

Conferência rápida com o painel no ar: `npm run smoke:tv`.

## Na TV

| Ação | Como |
|---|---|
| Modo demonstração | clique no logo ou `?demo=1` (não fica salvo) |
| Cartão do personagem | clique no personagem (Esc fecha) |
| Modo edição (decoração) | tecla **E** ou botão "✎ Editar" |

- **Escritório:** um andar com todas as salas de projeto (acesas e apagadas, em ordem alfabética), um corredor com a área de espera e, embaixo, a sala do Friol e o lazer. Cada sala tem uma mesa por funcionário cadastrado + 1 (até 4).
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
