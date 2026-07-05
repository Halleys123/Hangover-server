import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { projectController } from '../controllers/ProjectController.js';

const router = Router();
router.use(authenticate);

router.get('/', projectController.listProjects.bind(projectController));
router.get('/:id', projectController.getProjectById.bind(projectController));
router.post('/', projectController.createProject.bind(projectController));
router.put('/:id', projectController.updateProject.bind(projectController));
router.put('/:id/canvas', projectController.updateProjectCanvas.bind(projectController));
router.post('/:id/components', projectController.addProjectComponent.bind(projectController));
router.delete('/:id/components/:name', projectController.deleteProjectComponent.bind(projectController));
router.post('/:id/datasheets', projectController.addProjectDatasheet.bind(projectController));
router.delete('/:id/datasheets/:datasheetId', projectController.deleteProjectDatasheet.bind(projectController));
router.delete('/:id', projectController.deleteProject.bind(projectController));

export default router;
