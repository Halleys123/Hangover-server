import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { componentController } from '../controllers/ComponentController.js';

const router = Router();
router.use(authenticate);

router.get('/catalog', componentController.getCatalog.bind(componentController));
router.get('/catalog/categories', componentController.getCategories.bind(componentController));
router.get('/', componentController.listComponents.bind(componentController));
router.get('/:id', componentController.getComponentById.bind(componentController));
router.post('/', componentController.createComponent.bind(componentController));
router.delete('/:id', componentController.deleteComponent.bind(componentController));

export default router;
