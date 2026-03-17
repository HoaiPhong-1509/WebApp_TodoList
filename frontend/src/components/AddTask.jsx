import React, { useState } from 'react'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/axios'

const AddTask = ({ handleNewTaskAdded, workspaceId }) => {
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const addTask = async () => {
    if (!workspaceId) {
      toast.error('Please select a workspace first.');
      return;
    }

    if (newTaskTitle.trim()) {
      try {
        await api.post('/tasks', { title: newTaskTitle, workspaceId });
        toast.success(`${newTaskTitle} Task added successfully!`);
        if (typeof handleNewTaskAdded === 'function') {
          handleNewTaskAdded();
        }
      } catch (error) {
        console.error('Error adding task:', error);
        toast.error('Failed to add task.');
      }

      setNewTaskTitle("");
    }
    else {
        toast.error('Task title cannot be empty.');
    }
  }

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      addTask();
    }
  }

  return (
    <Card className='p-6 border-0 bg-gradient-cart shadow-custom-lg'>
      <div className='flex flex-col gap-3 sm:flex-row'>
        <Input
          type='text'
          placeholder='Enter task title'
          className='h-12 text-base bg-slate-50 sm:flex-1 border-border/50 focus:border-primary/50 focus:ring-primary/20'
          value={newTaskTitle}
          onChange={(event) => setNewTaskTitle(event.target.value)}
          onKeyPress={handleKeyPress}
        />

        <Button
          variant='gradient'
          size='xl'
          className='px-6'
          onClick={addTask}
          disabled={!newTaskTitle.trim()}
        >
          <Plus className='size-5' />
          Add
        </Button>
      </div>
      
    </Card>
  )
}

export default AddTask