import React, { useState } from 'react'
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Calendar, CheckCircle2, Circle, SquarePen, Trash2 } from 'lucide-react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/lib/axios';


const TaskCard = ({ task, index, handleTaskChanged, workspaceId }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [updateTaskTitle, setUpdateTaskTitle] = useState(task.title || '');

  const deleteTask = async (taskId) => {
    if (!workspaceId) {
      toast.error('Please select a workspace first.');
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`, {
        params: { workspaceId },
      });
      toast.success('Task deleted successfully');
      handleTaskChanged?.();

    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task.');
    }
  };

  const updateTask = async () => {
    if (!workspaceId) {
      toast.error('Please select a workspace first.');
      return;
    }

    try {
      setIsEditing(false);
      await api.put(`/tasks/${task._id}`, { 
        title: updateTaskTitle,
        workspaceId,
      });
      toast.success('Task updated successfully');
      handleTaskChanged();
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task.');
    }
  };

  const toggleTaskCompleteButton = async () => {
    if (!workspaceId) {
      toast.error('Please select a workspace first.');
      return;
    }

    try {
      const normalizedStatus = task.status === 'active' ? 'todo' : task.status;
      const statusFlow = {
        todo: 'in_progress',
        in_progress: 'completed',
        completed: 'todo',
      };

      const nextStatus = statusFlow[normalizedStatus] || 'todo';

      await api.put(`/tasks/${task._id}`, {
        status: nextStatus,
        workspaceId,
      });

      const statusLabels = {
        todo: 'To Do',
        in_progress: 'In Progress',
        completed: 'Completed',
      };

      toast.success(`Task "${task.title}" moved to ${statusLabels[nextStatus]}.`);

      handleTaskChanged();
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task.');
    }
  }

  const handleKeyPress = async (e) => {
    if (e.key === 'Enter') {
      updateTask();
    }
  };

  return (
    <Card className={cn(
      'p-4 bg-gradient-card border-0 shadow-custom-md hover:shadow-custom-lg transition-all duration-200 animate-fade-in group',
      task.status === 'completed' && 'opacity-75'
    )}
      style = {{animationDelay: `${index * 50}ms`}}
    >
      <div className='flex items-center gap-4'>
        {/* nút tròn */}
        <Button
        variant='ghost'
        size='icon'
        className={cn(
          'flex-shrink-0 size-8 rounded-full leading-none transition-all duration-200',
          task.status === 'completed' ? 'text-success hover:text-success/80'
          : task.status === 'in_progress' ? 'text-primary bg-primary/10 ring-1 ring-primary/20 hover:bg-primary/15 hover:ring-primary/30'
          : 'text-muted-foreground hover:text-primary'
        )}
        onClick={toggleTaskCompleteButton}
      >
        {task.status === 'completed' ? (
          <CheckCircle2 className='size-5'/>
        ) : task.status === 'in_progress' ? (
          <span className='relative block size-5'>
            <span className='absolute inset-0 rounded-full border-[2px] border-primary/70 animate-pulse' />
            <span className='absolute inset-0 m-auto rounded-full size-2.5 bg-primary shadow-sm' />
          </span>
        ) : (
          <Circle className='size-5'/>
        )}
        </Button>

        {/* tiêu đề */}
        <div className='flex-1 min-w-0'>
        {isEditing ? (
          <Input 
            placeholder='Edit task...'
            className='flex-1 h-12 text-base border-border/50 focus:border-primary/50 focus:ring-primary/20'
            type ='text'
            value={updateTaskTitle}
            onChange={(e) => setUpdateTaskTitle(e.target.value)}
            onKeyPress={handleKeyPress}
            onBlur={() => {
              setUpdateTaskTitle(task.title || '');
            }}
          />
        ) : (
          <p
          className={cn(
            'text-base transition-all duration-200',
            task.status === 'completed' ?
            'line-through text-muted-foreground' :
            'text-foreground'
          )}
          >
            {task.title}
          </p>
        )}

        {/* ngày tạo và ngày hoàn thành */}
        <div className='flex items-center gap-2 mt-1'> 
          <Calendar className='size-3 text-muted-foreground'/>
          <span className='text-xs text-muted-foreground'>
            {new Date(task.createdAt).toLocaleString()}
          </span>
          {task.completedAt && (
            <>
              <span className='text-xs text-muted-foreground'> - </span>
              <Calendar className='size-3 text-muted-foreground'/>
              <span className='text-xs text-muted-foreground'>
                {new Date(task.completedAt).toLocaleString()}
              </span>
            </>
          )}
        </div>
        </div>
        

        {/* nút chỉnh và xóa */}
        <div className='hidden gap-2 group-hover:inline-flex animate-slide-up'>
          {/* nút edit */}
          <Button
            variant='ghost'
            size='icon'
            className='flex-shrink-0 transition-colors size-8 text-muted-foreground hover:text-info'
            onClick={() => {
              setIsEditing(!isEditing)
              setUpdateTaskTitle(task.title || '');
            }}
          >
            <SquarePen className='size-4'/>
          </Button>

          {/* nút xóa */}
          <Button
            variant='ghost'
            size='icon'
            className='flex-shrink-0 transition-colors size-8 text-muted-foreground hover:text-destructive'
            onClick={() => deleteTask(task._id)}
          >
            <Trash2 className='size-4'/>
          </Button>
        </div>
      
      </div>
    </Card>
  
  )
}

export default TaskCard