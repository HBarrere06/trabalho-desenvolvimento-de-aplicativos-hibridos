# Diário de pesquisa

## Contexto do TCC

O ADS-B Rescue apresenta trajetórias de aeronaves e áreas de busca para apoiar análises de busca e salvamento. Esta prova de conceito investiga como manter os dados da sessão disponíveis localmente, sem fazer chamadas ao banco de dados.

## Pergunta de pesquisa

Como um aplicativo desktop React com Electron pode salvar e recuperar localmente a última sessão de trajetórias sem consultar um banco de dados?

## Alternativas consideradas

| Opção | Serve para | Decisão |
|---|---|---|
| Electron com arquivo JSON no diretório `userData` | Reaproveitar a interface React existente e guardar um snapshot no armazenamento do aplicativo desktop | Escolhida para a PoC; simples de inspecionar, mas não indicada para consultas ou grandes volumes |
| SQLite | Consultas locais e conjuntos maiores, com estrutura e transações | Alternativa provável para produção; amplia o escopo da PoC |
| Cache apenas em memória | Manter dados enquanto a janela permanece aberta | Rejeitada porque não sobrevive ao fechamento do aplicativo |
| `localStorage` no renderer Electron | Cache simples da interface | Rejeitada no desktop: a tela é carregada por `file://`, cuja persistência de `localStorage` não é definida como portátil |

## Como a PoC funciona

1. A aplicação carrega as trajetórias do arquivo local `public/response.json`.
2. Grava as trajetórias e a data da sessão em `last-session.json` dentro do diretório de dados do Electron (`userData`), por IPC restrito.
3. O botão **Exibir última sessão** lê o snapshot salvo sem carregar novamente o JSON de demonstração.
4. O botão **Usar dados de demonstração** volta a carregar o arquivo local e atualiza o snapshot.

O cache guarda somente dados de voos. Os tiles cartográficos ainda vêm de um serviço externo e podem não aparecer sem internet. O JSON local incluído no projeto é uma base de demonstração; não há chamadas ao banco de dados. A versão web existente continua usando `localStorage` como alternativa no navegador.

## Fontes oficiais lidas

- Electron — `BrowserWindow` e opções de segurança: https://www.electronjs.org/docs/latest/api/browser-window
- Electron — segurança: https://www.electronjs.org/docs/latest/tutorial/security
- MDN — `Window.localStorage`: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- React — componentes e estado: https://react.dev/learn
- Electron — `ipcMain`: https://www.electronjs.org/docs/latest/api/ipc-main
- Electron — `contextBridge`: https://www.electronjs.org/docs/latest/api/context-bridge

## Onde a IA errou

- **Pedido:** implementar a persistência local na interface desktop React existente.
- **O que veio inicialmente:** usar `localStorage` para guardar a última sessão do app desktop.
- **Como percebi:** a documentação do MDN informa que o comportamento de `localStorage` para documentos `file://` não é definido e varia entre navegadores. A janela Electron carrega o bundle local por esse protocolo.
- **O certo:** no desktop, persistir um arquivo JSON sob `userData` por IPC restrito; manter `localStorage` apenas como alternativa para a versão web. A PoC usa apenas o conjunto local de demonstração e não tenta consultar o banco de dados.

## Resultado e próximos passos no TCC

A PoC demonstra uma janela desktop baseada em React/Electron, cache em arquivo persistente entre execuções e recuperação da sessão sem acesso ao banco. Considerar a viabilidade de armazenamento local com JSON e, caso necessário, considerar SQLite ou outro armazenamento local com consultas, além de definir política de expiração e sincronização.
