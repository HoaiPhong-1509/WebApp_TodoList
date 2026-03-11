import AddTask from '@/components/AddTask';
import React from 'react';
import { Header } from '@/components/Header';
import StatsAndFilters from '@/components/StatsAndFilters';
import TaskListPagination from '@/components/TaskListPagination';
import DateTimeFilter from '@/components/DateTimeFilter';
import TaskList from '@/components/TaskList';
import Footer from '@/components/Footer';

const HomePage = () => {
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
        <StatsAndFilters/>

        {/* Danh sách nhiệm vụ */}
        <TaskList/>

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