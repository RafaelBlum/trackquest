# 🎮 Quest Alert

**Overlay de conquistas do RetroAchievements para OBS Studio.**

Acompanhe suas conquistas, progresso e objetivos em tempo real durante suas lives e gravações — tudo dentro de uma fonte de navegador no OBS.

![Version](https://img.shields.io/badge/versão-1.0-blue)
![Year](https://img.shields.io/badge/ano-2026-green)

---

## ✨ Funcionalidades

- **🏆 Alerta de conquista** — pop-up animado com badge, título, descrição, pontos e barra de tempo
- **⭐ Banner de masterização** — alerta especial quando você masteriza um jogo (100% hardcore)
- **📊 Painel de progresso** — card fixo com ícone do jogo, barra de progresso, contagem e Rich Presence
- **🎯 Painel de objetivo** — mostra a conquista que você está tentando fazer, com fila de objetivos
- **🎨 Modo edição** — arraste, redimensione e personalize tudo direto no overlay
- **🔊 Sons customizáveis** — use seus próprios arquivos de som ou o beep retrô embutido

---

## 🚀 Instalação

### 1. Obtenha sua API Key do RetroAchievements

1. Acesse [retroachievements.org](https://retroachievements.org) e faça login
2. Vá em **Settings → Keys** e copie sua **Web API Key**

### 2. Adicione ao OBS

1. No OBS, adicione uma fonte do tipo **Navegador** (Browser Source)
2. Marque **"Arquivo local"** e selecione o arquivo `tracker-obs.html`
3. Defina a resolução para o tamanho da sua cena (ex.: 1920×1080)
4. Marque **"Interagir com a página quando não estiver ativa"** (opcional, para o modo edição)

### 3. Configure o usuário

Há duas formas de informar suas credenciais:

**Opção A — Pelo modo edição (recomendado):**
1. Clique com o botão direito na fonte → **Interagir**
2. Pressione `E` para entrar no modo edição
3. Clique em **Configurações** → aba **Sons e conta**
4. Preencha seu usuário e API Key e clique em **Salvar e conectar**

**Opção B — Pela URL:**
```
tracker-obs.html?user=SeuUsuario&key=SuaApiKey
```

---

## ⌨️ Atalhos (janela Interagir do OBS)

| Tecla | Ação |
|:-----:|------|
| `E` | Entrar / sair do modo edição |
| `T` | Testar alerta de conquista |
| `M` | Testar banner de masterização |
| `R` | Restaurar layout (reset) — só no modo edição |

---

## 🎨 Modo Edição

Ao pressionar `E` na janela **Interagir** do OBS, você pode:

- **Arrastar** os painéis (alerta, progresso e objetivo) para qualquer posição
- **Redimensionar** usando o canto branco ou a roda do mouse
- **Ajustar a largura** arrastando a alça lateral
- **Configurar efeitos** no painel de Configurações:

### Estilos prontos

| Preset | Descrição |
|--------|-----------|
| **Arcade** | Slide + reflexo + neon (padrão) |
| **Clean** | Fade suave + bordas arredondadas + tema escuro |
| **Minimalista** | Sem bordas, sem brilho, fundo transparente |

### Efeitos do alerta

| Efeito | Opções |
|--------|--------|
| Entrada | Deslizar · Zoom · Cair · Girar · Surgir |
| Brilho | Reflexo · Pulsar · Nenhum |
| Borda | Padrão (chanfrada) · Sem borda · Cantos retos · Arredondada |

### Temas do painel de progresso

| Tema | Cores |
|------|-------|
| **Neon** | Azul ciano (padrão) |
| **Fogo** | Laranja e vermelho |
| **Verde** | Verde esmeralda |
| **Rosa** | Rosa e magenta |
| **Escuro** | Cinza escuro com dourado |

### Painel de objetivo

- **Estilos:** Translúcido · Escuro sólido · Claro · Neon · Minimalista
- **Tamanhos de fonte** configuráveis para rótulo, título e descrição
- **Textos editáveis** para o rótulo e a mensagem de conclusão

---

## 🎯 Sistema de Objetivos

O painel de objetivo permite escolher conquistas para acompanhar durante o jogo:

1. No modo edição, clique em **Escolher objetivo**
2. Clique nas conquistas pendentes para adicionar à fila (a ordem dos cliques define a prioridade)
3. Clique novamente para remover da fila
4. A primeira conquista não obtida da fila aparece no painel
5. Ao conquistar, o painel mostra **"✓ Concluída!"** e avança para a próxima

A fila é salva por jogo no `localStorage` e persiste entre sessões.

---

## 🔊 Sons

O overlay toca um som a cada conquista desbloqueada e outro na masterização.

### Sons da pasta (padrão)

Coloque os arquivos na pasta `Assets/sound/`:

| Arquivo | Evento |
|---------|--------|
| `conquista.ogg` (ou `.mp3` / `.wav`) | Conquista desbloqueada |
| `masterizado.ogg` (ou `.mp3` / `.wav`) | Jogo masterizado |

Se nenhum arquivo for encontrado, um **beep retrô** é gerado automaticamente.

### Sons enviados pelo menu

No modo edição → **Configurações** → aba **Sons e conta**, você pode enviar seus próprios arquivos de som. Eles ficam salvos no IndexedDB do navegador e têm prioridade sobre os da pasta.

---

## ⚙️ Parâmetros de URL

Todos os parâmetros são opcionais. Valores informados na URL têm prioridade sobre os salvos.

| Parâmetro | Padrão | Descrição |
|-----------|--------|-----------|
| `user` | `blumzeira` | Usuário do RetroAchievements |
| `key` | — | Web API Key |
| `poll` | `8` | Intervalo de checagem de conquistas (segundos) |
| `time` | `7` | Duração do alerta na tela (segundos) |
| `pos` | `bl` | Posição do alerta: `tl` · `tr` · `bl` · `br` |
| `ppos` | `tl` | Posição do painel de progresso |
| `opos` | `tr` | Posição do painel de objetivo |
| `progress` | `1` | `0` para esconder o card de progresso |
| `sound` | `1` | `0` para silenciar |
| `hc` | `0` | `1` para alertar apenas conquistas hardcore |
| `scale` | `1` | Escala dos painéis (ex.: `1.25`) |
| `vol` | `0.8` | Volume dos sons (0 a 1) |
| `demo` | `0` | `1` para modo demonstração (sem API) |
| `debug` | `0` | `1` para exibir avisos de som nos testes |
| `sfx` | — | Caminho personalizado do som de conquista |
| `sfxmaster` | — | Caminho personalizado do som de masterização |

**Exemplo completo:**
```
tracker-obs.html?user=MeuUsuario&key=MinhaApiKey&pos=bl&ppos=tl&opos=tr&scale=1.1&hc=1
```

---

## 📁 Estrutura do Projeto

```
Track-Quest/
├── tracker-obs.html        → Página do overlay (fonte de navegador do OBS)
├── css/
│   └── style.css           → Estilos e animações
├── js/
│   └── app.js              → Lógica: API, alertas, edição, objetivos e sons
├── Assets/
│   ├── img/
│   │   └── Logo-trackQuest.png
│   └── sound/              → Sons de conquista e masterização (.ogg/.mp3/.wav)
└── README.md
```

---

## 🔗 APIs utilizadas

O overlay consome a [API pública do RetroAchievements](https://api-docs.retroachievements.org/):

| Endpoint | Uso |
|----------|-----|
| `API_GetUserRecentAchievements` | Conquistas recentes (polling) |
| `API_GetUserProfile` | Perfil e jogo atual |
| `API_GetGameInfoAndUserProgress` | Progresso detalhado e lista de conquistas |

---

## 📝 Notas

- O overlay foi feito para rodar como **fonte de navegador** no OBS. Funciona também em qualquer navegador moderno para testes.
- As posições, escalas, efeitos e credenciais são salvos no `localStorage` do navegador.
- Sons enviados pelo menu são armazenados no `IndexedDB`.
- Na primeira execução, conquistas já obtidas não disparam alertas (evita flood).
- A masterização é detectada automaticamente quando o progresso hardcore chega a 100%.

---

## 📄 Licença

Projeto pessoal de [Blumzeira](https://retroachievements.org/user/blumzeira).

---

<p align="center">
  <b>Quest Alert</b> · v1.0 · 2026
</p>
