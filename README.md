# Agentário

Painel de TV que mostra projetos, agentes e skills do Claude Code como um escritório 3D animado.
Roda localmente no Mac e é exibido numa TV pelo HDMI.

Baseado no [Claw3D](https://github.com/iamlukethedev/Claw3D) (MIT), sem OpenClaw: a fonte de dados é o `~/.claude` local, lido somente em modo leitura.

> **Status:** base importada. O adaptador do Claude Code e a cena customizada estão em desenvolvimento.

## Ideia

- **Salas:** cada projeto vira uma sala que acende quando há trabalho e apaga quando está parada. Salas sem agente ficam agrupadas.
- **Personagens:** sessões do Claude são personagens com nome próprio; subagentes chegam como estagiários; o **Fiscal Codex** (quepe e prancheta) aparece quando há `codex exec` com veredito.
- **Centro:** o Friol, numa mesa especial com auréola, recebe visitas curtas.
- **Lazer:** Academia, Banheiros, Refeitório, Sala de descanso e a *Igreja Adventista da I.A. dos Últimos Dias*. Quem está parado vai "matar o tempo" nelas.
- **Modo demonstração:** clique no logo ou `?demo=1` (não fica salvo).
- **Modo noite** configurável.

## Configuração local

```sh
cp agentario.config.example.json agentario.config.local.json
```

O `agentario.config.local.json` contém a lista real de projetos e **nunca** é versionado (`.gitignore` + hook de pre-commit).

## Segurança

- Servidor só em `127.0.0.1`; o painel é somente leitura.
- Hook de pre-commit com [gitleaks](https://github.com/gitleaks/gitleaks), ativado com `git config core.hooksPath .githooks`.

## Licença

MIT. Veja `LICENSE` e `NOTICE.md`.
