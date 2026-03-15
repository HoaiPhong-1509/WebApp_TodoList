import express from 'express';
import { 
    getAllTasks, 
    createTask, 
    updateTask, 
    deleteTask
} from '../controllers/tasksControllers.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(requireAuth);

router.get("/", getAllTasks);

router.post("/", createTask);

router.put("/:id", updateTask);

router.delete("/:id", deleteTask);

export default router;

