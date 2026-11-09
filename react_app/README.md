# ADS-B Rescue desktop PoC

Prova de conceito desktop em React + Electron para demonstrar a persistência local da última sessão de trajetórias.

## Executar

Na pasta `react_app`:

```powershell
npm install
npm run desktop
```

O comando compila a interface e abre uma janela Electron. Esta PoC não consulta um banco de dados em tempo real: carrega os dados de demonstração de `public/response.json` e salva uma cópia no armazenamento local do aplicativo.

O cabeçalho mostra há quanto tempo foi feita a consulta registrada em `clickedAt` no JSON. O botão de atualizar recarrega os dados locais; isso não faz uma nova consulta ao OpenSky nem altera a data de `clickedAt`. O cache fica em `last-session.json` no diretório `userData` do Electron. Os tiles do mapa ainda dependem de rede.

As trajetórias removem amostras repetidas no mesmo segundo. Quando há intervalos superiores a cinco minutos, somente o segmento mais recente é exibido, evitando desenhar várias rotas antigas para o mesmo voo ou sugerir deslocamentos que os dados não confirmam. Aeronaves com apenas uma posição continuam no mapa, mas não têm linha de rota. Após atualizar a normalização, recarregue os dados de demonstração para criar um novo snapshot; sessões salvas em versões anteriores não são compatíveis.

## Verificação

```powershell
npm test
npm run build
```

Os critérios escritos antes da implementação estão em [CRITERIOS.md](./CRITERIOS.md), e o registro da pesquisa em [PESQUISA.md](./PESQUISA.md).
