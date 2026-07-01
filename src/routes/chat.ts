import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { generateChatResponse } from '../services/llm.js';
import { queryComponentKnowledge } from '../services/cognee.js';
import type { ChatRequest, ChatResponse } from '../types/index.js';

const FALLBACK_RESPONSES = [
  'I can help you design your circuit. What components are you working with?',
  'Great question! To validate voltage compatibility, add your components to the canvas and run the validator.',
  'Check the datasheet library — upload your component PDFs and I can help extract pinout information.',
  'For I2C connections, make sure SDA and SCL lines have 4.7kΩ pull-up resistors to your logic voltage.',
];

const router = Router();
router.use(authenticate);

router.post('/', async (req, res, next) => {
  const { message, history = [], projectId } = req.body as ChatRequest;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Enrich with Cognee component knowledge from user's indexed datasheets
  let componentContext = '';
  try {
    componentContext = await queryComponentKnowledge(message);
  } catch {
    // Cognee not configured — continue without context
  }

  try {
    const reply = await generateChatResponse(
      message,
      history,
      componentContext,
    );
    const response: ChatResponse = { reply, fallback: false };
    return res.json(response);
  } catch (err: any) {
    if (err.message === 'LLM_NOT_CONFIGURED') {
      const reply =
        FALLBACK_RESPONSES[
          Math.floor(Math.random() * FALLBACK_RESPONSES.length)
        ];
      return res.json({ reply, fallback: true } as ChatResponse);
    }
    next(err);
  }
});

export default router;
