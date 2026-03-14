import AddTask from '@/components/AddTask';
import React, { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import StatsAndFilters from '@/components/StatsAndFilters';
import TaskListPagination from '@/components/TaskListPagination';
import DateTimeFilter from '@/components/DateTimeFilter';
import TaskList from '@/components/TaskList';
import Footer from '@/components/Footer';
import { toast } from 'sonner';
import axios from 'axios';

const HomePage = () => {
  const [taskBuffer, setTaskBuffer] = useState([]);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [completedTaskCount, setCompletedTaskCount] = useState(0);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchTasks();
  }, [])

  const fetchTasks = async () => {
    try {

      const res = await axios.get('http://localhost:5001/api/tasks');
      setTaskBuffer(res.data.tasks);
      setActiveTaskCount(res.data.activeCount);
      setCompletedTaskCount(res.data.completedCount);

    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to fetch tasks. Please try again later.');
    }
  };

  const filteredTasks = taskBuffer.filter(task => {
    switch (filter) {
      case 'active':
        return task.status === 'active';
      case 'completed':
        return task.status === 'completed';
      default:
        return true;
    }
  });

  return (
<div className="min-h-screen w-full relative">
  {/* Radial Gradient Background from Top */}
  <div
    className="absolute inset-0 z-0"
    style={{
      background: "radial-gradient(125% 125% at 50% 10%, #fff 40%, #7c3aed 100%)",
    }}
  />
  {/* Your Content/Components */}

   <div className='container pt-8 mx-auto relative z-10'>
      <div className='w-full max-w-2xl p-6 mx-auto space-y-6'>

        {/* Đầu trang */}
        <Header/>

        {/* Tạo nhiệm vụ */}
        <AddTask/>

        {/* Thống kê và bộ lọc */}
        <StatsAndFilters
          filter={filter}
          setFilter={setFilter}
          activeTasksCount={activeTaskCount}
          completedTasksCount={completedTaskCount}
        
        />

        {/* Danh sách nhiệm vụ */}
        <TaskList filteredTasks={filteredTasks} filter={filter}/>

        {/* Phân trang và lọc theo Date */}
        <div className='flex flex-col items-center justify-between gap-6 sm:flex-row'>
          <TaskListPagination/>
          <DateTimeFilter/>
        </div>

        {/* Chân trang */}
        <Footer/>

      </div>
    </div>
</div>


  )
}

export default HomePage;