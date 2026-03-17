const express = require('express');
const path = require('path');
const { loadConfig } = require('./src/core/config');
const { buildPromptContext } = require('./src/core/promptContext');
const { createDiaryStore } = require('./src/core/diaryStore');
const { createModelRouter } = require('./src/core/modelRouter');
const { createFileService } = require('./src/core/fileService');
const { createSelfUpdateService } = require('./src/core/selfUpdate');

const app = express();
const config = loadConfig(path.join(process.cwd(), 'config', 'app-config.json'));
const diaryStore = createDiaryStore(path.join(process.cwd(), 'data'));
const fileService = createFileService(process.cwd(), config.fileService);
const modelRouter = createModelRouter(config.modelProviders);
const selfUpdate = createSelfUpdateService(process.cwd(), config.selfUpdate, diaryStore);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'local-ai-desktop-sim' });
});

app.get('/api/config', (_req, res) => {
  res.json({
    modelProviders: config.modelProviders,
    defaultSystemPromptPath: config.systemPromptPath,
    browserPane: config.browserPane
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { providerKey, messages, systemPromptOverride } = req.body || {};
    const promptContext = buildPromptContext({
      projectRoot: process.cwd(),
      systemPromptPath: path.join(process.cwd(), config.systemPromptPath)
    });

    const result = await modelRouter.chat({
      providerKey,
      messages: Array.isArray(messages) ? messages : [],
      systemPrompt: systemPromptOverride || promptContext.systemPrompt,
      contextSummary: promptContext
    });

    diaryStore.appendEvent({
      type: 'chat.request.completed',
      providerKey,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      model: result.model,
      timestamp: new Date().toISOString()
    });

    res.json(result);
  } catch (error) {
    diaryStore.appendEvent({
      type: 'chat.request.failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/list', (req, res) => {
  try {
    const relativePath = req.query.path || '.';
    const data = fileService.list(relativePath);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/files/read', (req, res) => {
  try {
    const relativePath = req.query.path;
    const data = fileService.read(relativePath);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/diary', (_req, res) => {
  res.json(diaryStore.readDiary());
});

app.post('/api/diary/event', (req, res) => {
  diaryStore.appendEvent({
    ...req.body,
    timestamp: req.body?.timestamp || new Date().toISOString()
  });
  res.json({ ok: true });
});

app.post('/api/self-update/propose', (req, res) => {
  try {
    const proposal = selfUpdate.propose(req.body || {});
    res.json(proposal);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/self-update/apply', (req, res) => {
  try {
    const result = selfUpdate.apply(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  diaryStore.appendEvent({
    type: 'server.started',
    port,
    timestamp: new Date().toISOString()
  });
  console.log(`local-ai-desktop-sim running at http://localhost:${port}`);
});
